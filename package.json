FROM node:22-alpine

# 安装依赖
RUN apk update && apk add --no-cache unzip python3 bash procps wget

WORKDIR /app

# 预下载并解压 nezha-agent（amd64架构，多架构环境需自行调整）
RUN wget -O agent.zip https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_amd64.zip \
    && unzip agent.zip -d /app \
    && chmod +x /app/nezha-agent \
    && rm agent.zip

COPY index.js /app/index.js

EXPOSE 4567

CMD ["node", "index.js"]
