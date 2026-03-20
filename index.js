import express from "express";
import axios from "axios";
import cors from "cors";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import NodeCache from "node-cache";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const CACHE_TTL = 60 * 30; // 30 minutos
const cache = new NodeCache();

// 🧩 Utilitário de log
function log(msg, type = "info") {
  const ts = new Date().toISOString();
  const prefix = type === "error" ? "[❌]" : type === "warn" ? "[⚠️]" : "[🟢]";
  console.log(`${prefix} [${ts}] ${msg}`);
}

async function fetchWithFallback(url, platform) {
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    return { html: data, source: "axios" };
  } catch (err) {
    try {
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
      const html = await page.content();
      await browser.close();
      return { html, source: "puppeteer" };
    } catch (err2) {
      return null;
    }
  }
}

// Scrapers
async function scrapeSteamFree() {
  const url = "https://store.steampowered.com/search/?filter=free&ndl=1&cc=br";
  const result = await fetchWithFallback(url, "Steam Free");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $(".search_result_row").each((_, el) => {
    const title = $(el).find(".title").text().trim();
    const appid = $(el).attr("data-ds-appid");
    const priceText = $(el).find(".search_price").text().trim().toLowerCase();
    const discount = $(el).find(".discount_pct").text().trim();
    const storeUrl = $(el).attr("href");
    
    // Usar imagem vertical de alta qualidade (600x900)
    const imageUrl = appid 
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`
      : $(el).find("img").attr("src").replace("capsule_616x353", "header");
    
    const isGiveaway = discount.includes("100");
    const isFree = priceText.includes("gratuito") || priceText.includes("0,00") || (priceText.includes("free") && !priceText.includes("play"));

    if (title && (isGiveaway || isFree)) {
      jogos.push({ 
        title, 
        price: "GRÁTIS", 
        description: "Resgate este jogo gratuitamente na Steam.",
        originalPrice: isGiveaway ? "R$ --" : null, 
        discount: isGiveaway ? "-100%" : null, 
        storeUrl, 
        imageUrl, 
        fallbackImage: $(el).find("img").attr("src").replace("capsule_616x353", "header"),
        platform: "Steam" 
      });
    }
  });
  return jogos.slice(0, 15);
}

async function scrapeSteamSpecials() {
  const url = "https://store.steampowered.com/search/?specials=1&cc=br";
  const result = await fetchWithFallback(url, "Steam Specials");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $(".search_result_row").each((_, el) => {
    const title = $(el).find(".title").text().trim();
    const appid = $(el).attr("data-ds-appid");
    const price = $(el).find(".discount_final_price").text().trim();
    const originalPrice = $(el).find(".discount_original_price").text().trim();
    const discount = $(el).find(".discount_pct").text().trim();
    const storeUrl = $(el).attr("href");
    
    const imageUrl = appid 
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`
      : $(el).find("img").attr("src").replace("capsule_616x353", "header");

    if (title && discount) {
      jogos.push({ 
        title, 
        price, 
        description: `Oferta especial na Steam: ${discount} de desconto!`,
        originalPrice, 
        discount, 
        storeUrl, 
        imageUrl, 
        fallbackImage: $(el).find("img").attr("src").replace("capsule_616x353", "header"),
        platform: "Steam" 
      });
    }
  });
  return jogos.slice(0, 15);
}

async function scrapeEpicGames() {
  const url = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR";
  try {
    const { data } = await axios.get(url, { timeout: 8000 });
    const games = data.data.Catalog.searchStore.elements;
    const jogos = [];

    games.forEach(game => {
      const promo = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      const isFreeNow = promo && promo.discountSetting?.discountPercentage === 0;

      if (isFreeNow) {
        jogos.push({
          title: game.title,
          description: game.description || "Resgate este jogo gratuitamente na Epic Games Store.",
          price: "GRÁTIS",
          originalPrice: game.price.totalPrice.originalPrice > 0 ? `R$ ${ (game.price.totalPrice.originalPrice / 100).toFixed(2) }` : null,
          discount: "-100%",
          storeUrl: `https://store.epicgames.com/pt-BR/p/${game.catalogNs.mappings?.[0]?.pageSlug || game.productSlug || ""}`,
          imageUrl: game.keyImages.find(img => img.type === "OfferImageWide")?.url || game.keyImages.find(img => img.type === "Thumbnail")?.url || game.keyImages[0]?.url,
          platform: "Epic Games"
        });
      }
    });
    return jogos;
  } catch (err) {
    log(`Epic Games API falhou: ${err.message}`, "error");
    return [];
  }
}

async function scrapeXbox() {
  const url = "https://www.xbox.com/pt-BR/games/free";
  const result = await fetchWithFallback(url, "Xbox");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $(".m-product-placement-item").each((_, el) => {
    const title = $(el).find(".c-title").text().trim();
    const storeUrl = "https://xbox.com" + $(el).find("a").attr("href");
    const imageUrl = $(el).find("img").attr("src");
    if (title) jogos.push({ title, price: "GRÁTIS", description: "Jogo gratuito na Xbox Store.", originalPrice: null, discount: null, storeUrl, imageUrl, platform: "Xbox" });
  });
  return jogos.slice(0, 10);
}

async function scrapePSN() {
  const url = "https://store.playstation.com/pt-br/category/05a5a687-0740-4f63-952b-edba01168f11/1";
  const result = await fetchWithFallback(url, "PSN");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $(".psw-product-tile").each((_, el) => {
    const title = $(el).find(".psw-product-tile__title").text().trim();
    const priceText = $(el).find(".psw-m-r-3").text().trim();
    const price = priceText || "GRÁTIS";
    const storeUrl = "https://store.playstation.com" + $(el).find("a").attr("href");
    const imageUrl = $(el).find("img").attr("src");
    if (title) jogos.push({ title, price, description: "Oferta disponível na PlayStation Store.", originalPrice: null, discount: null, storeUrl, imageUrl, platform: "PSN" });
  });
  return jogos.slice(0, 10);
}

// 🔁 Rota: /api/games/:platform
app.get("/api/games/:platform", async (req, res) => {
  const { platform } = req.params;
  const cacheKey = `games_${platform}`;
  if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

  try {
    let data = [];
    if (platform === "steam") {
        const [free, specials] = await Promise.all([scrapeSteamFree(), scrapeSteamSpecials()]);
        data = [...free, ...specials];
    }
    else if (platform === "epic") data = await scrapeEpicGames();
    else if (platform === "xbox") data = await scrapeXbox();
    else if (platform === "psn") data = await scrapePSN();
    else if (platform === "descobrir") {
      const results = await Promise.all([scrapeSteamFree(), scrapeEpicGames(), scrapeXbox()]);
      data = results.flat();
    }
    else if (platform === "promocoes") {
        data = await scrapeSteamSpecials();
    }

    cache.set(cacheKey, data, CACHE_TTL);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Falha no scraper" });
  }
});

// Root route: Serve HTML
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

export default app;
