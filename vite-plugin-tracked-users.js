import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isValidTrackedData, DEFAULT_TRACKED_DATA } from './src/lib/trackedUsers.js';

export function trackedUsersPlugin({
    dataDir = path.resolve(process.cwd(), 'data'),
    fileName = 'tracked-users.json',
} = {}) {
    const filePath = path.join(dataDir, fileName);

    return {
        name: 'vite-plugin-tracked-users',
        apply: 'serve',
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url, 'http://localhost');
                if (url.pathname !== '/api/tracked') {
                    return next();
                }

                if (req.method === 'GET') {
                    try {
                        if (fs.existsSync(filePath)) {
                            const content = await fs.promises.readFile(filePath, 'utf8');
                            const parsed = JSON.parse(content);
                            res.statusCode = 200;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify(parsed));
                        } else {
                            res.statusCode = 200;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify(DEFAULT_TRACKED_DATA));
                        }
                    } catch {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify({ error: 'Failed to read tracked users data' }));
                    }
                    return;
                }

                if (req.method === 'PUT') {
                    let raw = '';
                    req.on('data', chunk => {
                        raw += chunk;
                        if (raw.length > 1024 * 1024) {
                            res.statusCode = 413;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({ error: 'Payload too large' }));
                            req.destroy();
                        }
                    });

                    req.on('end', async () => {
                        let body;
                        try {
                            body = JSON.parse(raw);
                        } catch {
                            res.statusCode = 400;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
                            return;
                        }

                        if (!isValidTrackedData(body)) {
                            res.statusCode = 400;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({ error: 'Invalid tracked users data shape' }));
                            return;
                        }

                        try {
                            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
                            const tempPath = path.join(
                                path.dirname(filePath),
                                `.${fileName}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`
                            );
                            await fs.promises.writeFile(tempPath, JSON.stringify(body, null, 2), 'utf8');
                            await fs.promises.rename(tempPath, filePath);

                            res.statusCode = 200;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({ ok: true, data: body }));
                        } catch {
                            res.statusCode = 500;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({ error: 'Failed to write tracked users data' }));
                        }
                    });

                    req.on('error', () => {
                        if (!res.headersSent) {
                            res.statusCode = 500;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({ error: 'Request stream error' }));
                        }
                    });
                    return;
                }

                res.statusCode = 405;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'Method Not Allowed' }));
            });
        },
    };
}
