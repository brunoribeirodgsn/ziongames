// api/index.js — Zion Games v3 para Vercel
import express from "express";
import axios from "axios";
import cors from "cors";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import NodeCache from "node-cache";
import * as cheerio from "cheerio";

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

// 🧠 Função de fallback automático optimizada para Vercel
async function fetchWithFallback(url, platform) {
  try {
    const { data } = await axios.get(url, { 
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    return { html: data, source: "axios" };
  } catch (err) {
    log(`${platform}: Axios falhou (${err.message}), tentando Puppeteer...`, "warn");
    try {
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
      const html = await page.content();
      await browser.close();
      return { html, source: "puppeteer" };
    } catch (err2) {
      log(`${platform}: Puppeteer também falhou -> ${err2.message}`, "error");
      return null;
    }
  }
}

// ... (Scrapers iguais aos do server.js - vou copiar e adaptar para retornar os objetos padronizados)

async function scrapeSteamFree() {
  const url = "https://store.steampowered.com/search/?filter=free&ndl=1";
  const result = await fetchWithFallback(url, "Steam Free");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $(".search_result_row").each((_, el) => {
    const title = $(el).find(".title").text().trim();
    const price = "Gratuito";
    const storeUrl = $(el).attr("href");
    const imageUrl = $(el).find("img").attr("src");
    if (title) jogos.push({ title, price, originalPrice: null, discount: null, storeUrl, imageUrl, platform: "Steam" });
  });
  return jogos.slice(0, 15);
}

async function scrapeSteamSpecials() {
  const url = "https://store.steampowered.com/search/?specials=1";
  const result = await fetchWithFallback(url, "Steam Specials");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $(".search_result_row").each((_, el) => {
    const title = $(el).find(".title").text().trim();
    const price = $(el).find(".discount_final_price").text().trim();
    const originalPrice = $(el).find(".discount_original_price").text().trim();
    const discount = $(el).find(".discount_pct").text().trim();
    const storeUrl = $(el).attr("href");
    const imageUrl = $(el).find("img").attr("src");
    if (title && discount) jogos.push({ title, price, originalPrice, discount, storeUrl, imageUrl, platform: "Steam" });
  });
  return jogos.slice(0, 15);
}

async function scrapeEpicGames() {
  const url = "https://store.epicgames.com/pt-BR/free-games";
  const result = await fetchWithFallback(url, "Epic Games");
  if (!result) return [];
  const $ = cheerio.load(result.html);
  const jogos = [];
  $("div[data-testid='offer-card-wrapper']").each((_, el) => {
    const title = $(el).find("[data-testid='title-library-item']").text().trim() || $(el).find(".css-2ucwu").text().trim();
    const storeUrl = "https://store.epicgames.com" + $(el).find("a").attr("href");
    const imageUrl = $(el).find("img").attr("src");
    if (title && !title.includes("Em breve")) {
      jogos.push({ title, price: "Gratuito", originalPrice: null, discount: null, storeUrl, imageUrl, platform: "Epic Games" });
    }
  });
  return jogos.slice(0, 10);
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
    if (title) jogos.push({ title, price: "Gratuito", originalPrice: null, discount: null, storeUrl, imageUrl, platform: "Xbox" });
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
    const price = $(el).find(".psw-m-r-3").text().trim() || "Gratuito";
    const storeUrl = "https://store.playstation.com" + $(el).find("a").attr("href");
    const imageUrl = $(el).find("img").attr("src");
    if (title) jogos.push({ title, price, originalPrice: null, discount: null, storeUrl, imageUrl, platform: "PSN" });
  });
  return jogos.slice(0, 10);
}

// 🔁 Rota: /api/games/:platform
app.get("/api/games/:platform", async (req, res) => {
  const { platform } = req.params;
  const valid = ["steam", "epic", "xbox", "psn", "descobrir", "promocoes"];
  if (!valid.includes(platform)) return res.status(400).json({ error: "Plataforma inválida" });

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

app.get("/api", (req, res) => res.send("Zion Games API v3 rodando no Vercel"));

export default app;
