import express, { Request, Response } from 'express';
import axios, { AxiosResponse, Method, RawAxiosRequestHeaders } from 'axios';
import https from 'https';
import stream from 'stream';

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_DOMAIN = 'https://www.weintek.com';

const CACHE_MAX_AGE = 60 * 60 * 24 * 7;
const TIMEOUT = 30000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const staticFileExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf', '.eot'];

app.use('/', async (req: Request, res: Response) => {
  try {
    const targetUrl = TARGET_DOMAIN + req.url;
    const isStatic = staticFileExtensions.some(ext => req.url.toLowerCase().includes(ext));
    
    console.log(`[${new Date().toISOString()}] ${isStatic ? '📷' : '📄'} ${req.method} ${req.url}`);

    const headers: RawAxiosRequestHeaders = {
      'User-Agent': req.headers['user-agent'] as string || 'Mozilla/5.0 (compatible; ProxyBot/1.0)',
      'Accept': req.headers['accept'] as string || '*/*',
      'Accept-Language': req.headers['accept-language'] as string || 'ru-RU,ru;q=0.9,en;q=0.8',
    };

    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie as string;
    if (req.headers.referer) headers['Referer'] = req.headers.referer as string;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;
    if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'] as string;
    if (req.headers['if-modified-since']) headers['If-Modified-Since'] = req.headers['if-modified-since'] as string;

    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      maxSockets: 100,
      maxFreeSockets: 10,
      timeout: 60000,
    });

    const axiosConfig: any = {
      method: req.method as Method,
      url: targetUrl,
      headers: headers,
      responseType: 'stream',
      data: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? req.body : undefined,
      httpsAgent: httpsAgent,
      timeout: TIMEOUT,
      maxRedirects: 5,
      validateStatus: () => true,
      decompress: true,
    };

    const response: AxiosResponse = await axios(axiosConfig);

    res.status(response.status);

    const headersToSkip = [
      'content-encoding',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'upgrade',
    ];

    const securityHeadersToRemove = [
      'x-frame-options',
      'content-security-policy'
    ];

    Object.entries(response.headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (!headersToSkip.includes(lowerKey) && !securityHeadersToRemove.includes(lowerKey) && value) {
        if (isStatic && lowerKey === 'content-type' && value.toString().includes('image')) {
          res.setHeader('Cache-Control', `public, max-age=${CACHE_MAX_AGE}, immutable`);
          res.setHeader('Expires', new Date(Date.now() + CACHE_MAX_AGE * 1000).toUTCString());
        }
        res.setHeader(key, Array.isArray(value) ? value.join(', ') : value);
      }
    });

    res.setHeader('X-Proxy-Server', 'Node.js/Express');
    res.setHeader('X-Proxy-Timestamp', new Date().toISOString());
    if (isStatic) {
      res.setHeader('X-Proxy-Cache', 'HIT');
    }

    const contentType = response.headers['content-type'] as string || '';

    if (contentType.includes('text/html')) {
      let html = '';
      response.data.on('data', (chunk: Buffer) => {
        html += chunk.toString('utf-8');
      });
      
      response.data.on('end', () => {
        try {
          let modifiedHtml = html
            .replace(new RegExp(TARGET_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
            .replace(/https?:\/\//g, '//')
            .replace(/(href|src|action)=(["'])\/(?!\/)/g, '$1=$2/')
            .replace(/url\(["']?\/(?!\/)/g, 'url(/')
            .replace('<head>', '<head><base href="/">');

          res.send(modifiedHtml);
        } catch (err) {
          console.error('Ошибка при обработке HTML:', err);
          res.send(html);
        }
      });
    } else {
      response.data.pipe(res);
      
      response.data.on('error', (err: any) => {
        console.error('Ошибка потока данных:', err);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
      
      req.on('close', () => {
        response.data.destroy();
      });
    }

  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ❌ Ошибка прокси:`, error.message);
    
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Proxy error',
        message: error.message,
        url: req.url,
        timestamp: new Date().toISOString()
      });
    }
  }
});

process.on('SIGTERM', () => {
  console.log('Получен SIGTERM, завершаем работу...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Прокси-сервер запущен на http://localhost:${PORT}`);
  console.log(`🎯 Целевой домен: ${TARGET_DOMAIN}`);
  console.log(`📸 Оптимизация для статики включена`);
});