const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const pino = require('pino');
const pretty = require('pino-pretty');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_DOMAIN = 'www.weintek.com';
const W1_DOMAIN = 'w1.weintek.com';
const CDN_DOMAIN = 'cdn.weintek.cloud';
const CHATBOT_DOMAIN = 'chatbot.weincloud.net';
const PROXY_DOMAIN = process.env.PROXY_DOMAIN || 'sss55.space';

const proxyAgent = process.env.HTTP_PROXY ? new HttpsProxyAgent(process.env.HTTP_PROXY) : null;

const axiosInstance = axios.create({
  httpsAgent: proxyAgent || new https.Agent({ 
    rejectUnauthorized: false,
    keepAlive: true
  }),
  timeout: 30000,
  maxRedirects: 5,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
});

app.use(cookieParser());
app.use(cors({
  origin: [`https://${PROXY_DOMAIN}`, `http://${PROXY_DOMAIN}`],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
    referer: req.get('Referer') || 'direct'
  }, 'Incoming request');
  next();
});

function replaceDomains(content, contentType) {
  if (!content || typeof content !== 'string') return content;

  let replaced = content;

  replaced = replaced
    .replace(/crossorigin(=["'][^"']*["'])?/g, '')
    .replace(/\s+crossorigin\b/g, '')
    .replace(/\bcrossorigin\b/g, '');

  if (contentType.includes('text/html')) {
    const $ = cheerio.load(replaced);
    
    $('[crossorigin]').removeAttr('crossorigin');
    $('script[src*="/bundles/"]').remove();
    $('script[src*="modernizr"]').remove();
    $('script[src*="jquery"]').remove();
    $('script[src*="bootstrap"]').remove();
    $('script[src*="swiper"]').remove();
    
    $('[src*="w1.weintek.com"], [href*="w1.weintek.com"]').each((i, el) => {
      const attr = $(el).attr('src') ? 'src' : 'href';
      const value = $(el).attr(attr);
      if (value) {
        $(el).attr(attr, value.replace(W1_DOMAIN, PROXY_DOMAIN));
      }
    });
    
    $('[src*="cdn.weintek.cloud"], [href*="cdn.weintek.cloud"]').each((i, el) => {
      const attr = $(el).attr('src') ? 'src' : 'href';
      const value = $(el).attr(attr);
      if (value) {
        $(el).attr(attr, value.replace(CDN_DOMAIN, `${PROXY_DOMAIN}/cdn`));
      }
    });

    $('[src*="chatbot.weincloud.net"], [href*="chatbot.weincloud.net"]').each((i, el) => {
      const attr = $(el).attr('src') ? 'src' : 'href';
      const value = $(el).attr(attr);
      if (value) {
        $(el).attr(attr, value.replace(CHATBOT_DOMAIN, `${PROXY_DOMAIN}/chatbot`));
      }
    });
    
    replaced = $.html();
  }

  if (contentType.includes('javascript') || contentType.includes('css')) {
    replaced = replaced
      .replace(/crossorigin[=]["']?[^"'\s]*["']?/g, '')
      .replace(new RegExp(`["']https?://${W1_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `"https://${PROXY_DOMAIN}`)
      .replace(new RegExp(`["']https?://${CDN_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `"https://${PROXY_DOMAIN}/cdn`)
      .replace(new RegExp(`["']https?://${CHATBOT_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `"https://${PROXY_DOMAIN}/chatbot`);
  }

  replaced = replaced
    .replace(new RegExp(`https?://(?:www\\.)?${CHATBOT_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `https://${PROXY_DOMAIN}/chatbot`)
    .replace(new RegExp(`//${CHATBOT_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `//${PROXY_DOMAIN}/chatbot`)
    .replace(new RegExp(`${CHATBOT_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `${PROXY_DOMAIN}/chatbot`)
    .replace(new RegExp(`https?://${W1_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `https://${PROXY_DOMAIN}`)
    .replace(new RegExp(`//${W1_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `//${PROXY_DOMAIN}`)
    .replace(new RegExp(`https?://${CDN_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `https://${PROXY_DOMAIN}/cdn`)
    .replace(new RegExp(`//${CDN_DOMAIN.replace(/\./g, '\\.')}`, 'g'), `//${PROXY_DOMAIN}/cdn`);

  replaced = replaced.replace(
    '<script type="module" src="/js/index.8LxikIYk.js">',
    '<script src="/js/index.8LxikIYk.js">'
  );

  return replaced;
}

async function proxyRequest(req, res, targetUrl, targetHost) {
  try {
    const method = req.method.toLowerCase();
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      ...(req.get('Cookie') && { 'Cookie': req.get('Cookie') }),
      ...(req.get('Referer') && { 'Referer': req.get('Referer').replace(PROXY_DOMAIN, TARGET_DOMAIN) })
    };

    const response = await axiosInstance({
      method,
      url: targetUrl,
      headers,
      data: method === 'post' || method === 'put' ? req.body : undefined,
      params: req.query,
      responseType: 'arraybuffer'
    });

    const contentType = response.headers['content-type'] || '';
    
    if (response.headers['set-cookie']) {
      res.set('Set-Cookie', response.headers['set-cookie'].map(cookie => 
        cookie.replace(targetHost, PROXY_DOMAIN)
      ));
    }

    ['cache-control', 'expires', 'pragma', 'etag', 'last-modified'].forEach(header => {
      if (response.headers[header]) {
        res.set(header, response.headers[header]);
      }
    });

    let data = response.data;
    
    if (targetHost === CHATBOT_DOMAIN || 
        contentType.includes('text/html') || 
        contentType.includes('javascript') || 
        contentType.includes('css') ||
        contentType.includes('xml')) {
      const content = data.toString('utf-8');
      data = Buffer.from(replaceDomains(content, contentType), 'utf-8');
    }

    res.set('Content-Type', contentType);
    res.status(response.status).send(data);

    logger.debug({
      status: response.status,
      url: targetUrl,
      contentType: contentType.split(';')[0]
    }, 'Proxied request');

  } catch (error) {
    logger.error({
      url: targetUrl,
      status: error.response?.status,
      message: error.message
    }, 'Proxy error');

    res.status(error.response?.status || 500).send(error.response?.data || 'Proxy error');
  }
}

app.get('/js/index.8LxikIYk.js', (req, res) => {
  const filePath = path.join(__dirname, 'static/js/index.8LxikIYk.js');
  
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    'ETag': Date.now().toString()
  });
  
  res.sendFile(filePath, (err) => {
    if (err) {
      logger.error({ err }, 'Error sending main script file');
      res.status(500).send('console.error("Failed to load main script");');
    }
  });
});

app.use('/weinbot-plugin-1.0.0.js', async (req, res) => {
  const targetUrl = `https://${CHATBOT_DOMAIN}/weinbot-plugin-1.0.0.js`;
  await proxyRequest(req, res, targetUrl, CHATBOT_DOMAIN);
});

app.use('/chatbot', async (req, res) => {
  const targetUrl = `https://${CHATBOT_DOMAIN}${req.url}`;
  await proxyRequest(req, res, targetUrl, CHATBOT_DOMAIN);
});

app.use('/js', async (req, res) => {
  const targetUrl = `https://${CHATBOT_DOMAIN}/js${req.url}`;
  await proxyRequest(req, res, targetUrl, CHATBOT_DOMAIN);
});

app.use('/css', async (req, res) => {
  const targetUrl = `https://${CHATBOT_DOMAIN}/css${req.url}`;
  await proxyRequest(req, res, targetUrl, CHATBOT_DOMAIN);
});

app.use('/w1', async (req, res) => {
  const targetUrl = `https://${W1_DOMAIN}${req.url}`;
  await proxyRequest(req, res, targetUrl, W1_DOMAIN);
});

app.use('/wkstatic', async (req, res) => {
  const targetUrl = `https://${W1_DOMAIN}/wkstatic${req.url}`;
  await proxyRequest(req, res, targetUrl, W1_DOMAIN);
});

app.use('/cdn', async (req, res) => {
  const targetUrl = `https://${CDN_DOMAIN}${req.url}`;
  await proxyRequest(req, res, targetUrl, CDN_DOMAIN);
});

app.get('/*', async (req, res) => {
  const targetUrl = `https://${TARGET_DOMAIN}${req.url}`;
  await proxyRequest(req, res, targetUrl, TARGET_DOMAIN);
});

app.get('/', async (req, res) => {
  const targetUrl = `https://${TARGET_DOMAIN}${req.url}`;
  await proxyRequest(req, res, targetUrl, TARGET_DOMAIN);
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Weintek proxy running on port ${PORT}`);
  logger.info(`Proxy domain: ${PROXY_DOMAIN}`);
  logger.info(`Target: ${TARGET_DOMAIN}`);
  logger.info(`W1: ${W1_DOMAIN}`);
  logger.info(`CDN: ${CDN_DOMAIN}`);
  logger.info(`Chatbot: ${CHATBOT_DOMAIN}`);
});