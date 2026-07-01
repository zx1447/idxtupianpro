# 构建阶段
FROM node:20-alpine AS builder

# 预装原生模块编译依赖：python3 make g++ 适配 bcrypt/sharp/sqlite3
RUN apk update && apk add --no-cache unzip python3 make g++ && rm -rf /var/cache/apk/*

WORKDIR /app

# 主程序文件 index.js
COPY index.js .

# 运行阶段轻量化镜像
FROM node:20-alpine

# 运行时所需工具
RUN apk update && apk add --no-cache unzip python3 make g++ && rm -rf /var/cache/apk/*

# 非root安全用户运行
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

WORKDIR /app

# 拷贝代码，不携带任何密钥
COPY --from=builder /app/index.js ./

# 创建日志、临时目录并放开权限
RUN mkdir -p /app/logs /tmp/agent_dir && chmod 777 /tmp /app/logs

# 同步平台默认监听端口3000，消除端口警告
EXPOSE 3000

# 启动命令，密钥由平台运行时注入，不写在镜像内
CMD ["node", "index.js"]
