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

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
};

// 🧩 Utilitário de log
function log(msg, type = "info") {
  const ts = new Date().toISOString();
  const prefix = type === "error" ? "[❌]" : type === "warn" ? "[⚠️]" : "[🟢]";
  console.log(`${prefix} [${ts}] ${msg}`);
}

async function fetchWithFallback(url, platform) {
  try {
    const { data } = await axios.get(url, { 
      timeout: 8000,
      headers: DEFAULT_HEADERS
    });
    return { html: data, source: "axios" };
  } catch (err) {
    log(`Axios falhou para ${platform}, tentando Puppeteer...`, "warn");
    try {
      const browser = await puppeteer.launch({
        args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      const page = await browser.newPage();
      await page.setUserAgent(DEFAULT_HEADERS["User-Agent"]);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });
      const html = await page.content();
      await browser.close();
      return { html, source: "puppeteer" };
    } catch (err2) {
      log(`Puppeteer falhou para ${platform}: ${err2.message}`, "error");
      return null;
    }
  }
}

// Scrapers
async function scrapeSteamFree() {
  const url = "https://store.steampowered.com/search/?maxprice=free&supportedlang=brazilian&ndl=1&cc=br";
  const result = await fetchWithFallback(url, "Steam Free");
  if (!result || !result.html) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  
  $(".search_result_row").each((_, el) => {
    const title = $(el).find(".title").text().trim();
    const appid = $(el).attr("data-ds-appid");
    const storeUrl = $(el).attr("href");
    
    if (title && appid) {
      jogos.push({ 
        title, 
        price: "GRÁTIS", 
        description: "Jogo disponível gratuitamente na Steam.",
        originalPrice: null, 
        discount: null, 
        storeUrl, 
        imageUrl: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
        platform: "Steam" 
      });
    }
  });
  return jogos.slice(0, 20);
}

async function scrapeEpicGames() {
  const url = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR";
  try {
    const { data } = await axios.get(url, { 
      timeout: 8000, 
      headers: DEFAULT_HEADERS 
    });
    const games = data?.data?.Catalog?.searchStore?.elements || [];
    const jogos = [];

    games.forEach(game => {
      const promo = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
      const isFreeNow = promo && promo.discountSetting?.discountPercentage === 0;

      if (isFreeNow) {
        jogos.push({
          title: game.title,
          description: game.description || "Resgate este jogo gratuitamente na Epic Games Store.",
          price: "GRÁTIS",
          originalPrice: game.price?.totalPrice?.originalPrice > 0 ? `R$ ${ (game.price.totalPrice.originalPrice / 100).toFixed(2).replace(".", ",") }` : null,
          discount: "-100%",
          storeUrl: `https://store.epicgames.com/pt-BR/p/${game.catalogNs?.mappings?.[0]?.pageSlug || game.productSlug || ""}`,
          imageUrl: game.keyImages?.find(img => img.type === "OfferImageTall")?.url || game.keyImages?.find(img => img.type === "Thumbnail")?.url || game.keyImages?.[0]?.url,
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

async function scrapeSteamSpecials() {
  const url = "https://store.steampowered.com/search/?specials=1&cc=br";
  const result = await fetchWithFallback(url, "Steam Specials");
  if (!result || !result.html) return [];
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
      : $(el).find("img").attr("src")?.replace("capsule_616x353", "header");

    if (title && discount) {
      jogos.push({ 
        title, 
        price, 
        description: `Oferta especial na Steam: ${discount} de desconto!`,
        originalPrice, 
        discount, 
        storeUrl, 
        imageUrl: imageUrl || "https://community.akamai.steamstatic.com/public/images/applications/store/capsule_616x353.jpg",
        platform: "Steam" 
      });
    }
  });
  return jogos.slice(0, 20);
}

async function scrapeEpicSpecials() {
  // Use a very broad search limit to ensure we find some promos
  const url = "https://store-site-backend-static.ak.epicgames.com/api/v1/searchstore?limit=100&country=BR&locale=pt-BR&onSale=true";
  try {
    const { data } = await axios.get(url, { 
      timeout: 10000,
      headers: DEFAULT_HEADERS
    });
    const games = data?.data?.Catalog?.searchStore?.elements || [];
    const jogos = [];

    games.forEach(game => {
      // Epic sometimes has multiple offers, butTotalPrice is usually the main one
      const priceData = game.price?.totalPrice || game.price?.lineOffers?.[0]?.appliedRules?.[0] || {};
      const originalPrice = priceData.originalPrice || 0;
      const discountPrice = priceData.discountPrice || 0;
      
      if (discountPrice < originalPrice && discountPrice > 0) {
        const discountPercentage = Math.round(((originalPrice - discountPrice) / originalPrice) * 100);
        
        // Only add if it's not a free game (which goes to Epic Grátis)
        if (discountPercentage < 100) {
          jogos.push({
            title: game.title,
            description: game.description || "Oferta especial disponível na Epic Games Store.",
            price: `R$ ${(discountPrice / 100).toFixed(2).replace(".", ",")}`,
            originalPrice: `R$ ${(originalPrice / 100).toFixed(2).replace(".", ",")}`,
            discount: `-${discountPercentage}%`,
            storeUrl: `https://store.epicgames.com/pt-BR/p/${game.catalogNs?.mappings?.[0]?.pageSlug || game.productSlug || ""}`,
            imageUrl: game.keyImages?.find(img => img.type === "OfferImageTall")?.url || game.keyImages?.find(img => img.type === "Thumbnail")?.url || game.keyImages?.[0]?.url,
            platform: "Epic Games"
          });
        }
      }
    });

    if (jogos.length === 0) return await scrapeEpicSpecialsFallback();
    return jogos;
  } catch (err) {
    return await scrapeEpicSpecialsFallback();
  }
}

async function scrapeEpicSpecialsFallback() {
  const url = "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=pt-BR&country=BR&allowCountries=BR";
  try {
    const { data } = await axios.get(url, { timeout: 8000, headers: DEFAULT_HEADERS });
    const games = data?.data?.Catalog?.searchStore?.elements || [];
    const jogos = [];
    games.forEach(game => {
      const originalPrice = game.price?.totalPrice?.originalPrice || 0;
      const discountPrice = game.price?.totalPrice?.discountPrice || 0;
      if (discountPrice < originalPrice && discountPrice > 0) {
        const dp = Math.round(((originalPrice - discountPrice) / originalPrice) * 100);
        jogos.push({
          title: game.title,
          price: `R$ ${(discountPrice / 100).toFixed(2).replace(".", ",")}`,
          originalPrice: `R$ ${(originalPrice / 100).toFixed(2).replace(".", ",")}`,
          discount: `-${dp}%`,
          storeUrl: `https://store.epicgames.com/pt-BR/p/${game.catalogNs?.mappings?.[0]?.pageSlug || game.productSlug || ""}`,
          imageUrl: game.keyImages?.find(img => img.type === "OfferImageTall")?.url || game.keyImages?.[0]?.url,
          platform: "Epic Games"
        });
      }
    });
    return jogos;
  } catch (e) { return []; }
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
    if (platform === "steam") data = await scrapeSteamSpecials();
    else if (platform === "steam-free") data = await scrapeSteamFree();
    else if (platform === "epic") data = await scrapeEpicGames();
    else if (platform === "epic-promos") data = await scrapeEpicSpecials();
    else if (platform === "xbox") data = await scrapeXbox();
    else if (platform === "psn") data = await scrapePSN();
    else if (platform === "descobrir") {
      const results = await Promise.all([scrapeSteamFree(), scrapeEpicGames(), scrapeXbox()]);
      data = results.flat();
    }
    else if (platform === "promocoes") {
        const [steam, epic] = await Promise.all([scrapeSteamSpecials(), scrapeEpicSpecials()]);
        data = [...steam, ...epic];
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
