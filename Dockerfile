FROM node:20-slim

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装依赖工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    unzip \
    ca-certificates \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

WORKDIR /app

# 安装node依赖（--omit=dev消除npm警告）
COPY package*.json ./
RUN npm ci --omit=dev

# 使用ghproxy镜像下载nezha-agent，增加文件校验，构建阶段失败直接退出
RUN arch=$(uname -m) && \
    case "$arch" in \
        x86_64) ARCH=amd64 ;; \
        aarch64) ARCH=arm64 ;; \
        armv7l) ARCH=arm ;; \
        *) ARCH=amd64 ;; \
    esac && \
    echo "当前构建架构: $ARCH" && \
    curl -fsSL --connect-timeout 20 -o /tmp/agent.zip "https://mirror.ghproxy.com/https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" && \
    unzip -o /tmp/agent.zip -d /tmp/agent_temp/ && \
    mv /tmp/agent_temp/nezha-agent /usr/local/bin/ && \
    chmod 755 /usr/local/bin/nezha-agent && \
    # 打印文件信息用于排查
    ls -lh /usr/local/bin/nezha-agent && \
    # 文件不存在直接终止构建，不会到运行时报错
    test -f /usr/local/bin/nezha-agent || (echo "nezha-agent 二进制文件构建失败！" && exit 1) && \
    rm -rf /tmp/agent_temp /tmp/agent.zip

# 复制业务代码
COPY index.js .

# 创建普通运行用户并授权目录
RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && chown -R appuser:appuser /app \
    && chmod 777 /tmp

# 环境变量
ENV PORT=8080
EXPOSE 8080

# 切换非root用户运行
USER appuser

# 启动命令
CMD ["node", "index.js"]
