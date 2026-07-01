# 构建阶段
FROM node:20-alpine AS builder

RUN apk update && apk add --no-cache unzip python3 make g++ && rm -rf /var/cache/apk/*

WORKDIR /app

# 主文件是index.js
COPY index.js .

# 运行阶段
FROM node:20-alpine

# 预装原生依赖编译工具（适配SnapDeploy提示bcrypt/sharp/sqlite3）
RUN apk update && apk add --no-cache unzip python3 make g++ && rm -rf /var/cache/apk/*

# 非root用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

WORKDIR /app

COPY --from=builder /app/index.js ./

# 目录权限
RUN mkdir -p /app/logs /tmp/agent_dir && chmod 777 /tmp /app/logs

# 修正端口为3000，和平台默认一致
EXPOSE 3000

CMD ["node", "index.js"]
