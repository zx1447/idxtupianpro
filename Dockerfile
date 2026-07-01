# 构建阶段：安装依赖、准备环境
FROM node:20-alpine AS builder

# 安装代码运行必需系统工具
RUN apk update && apk add --no-cache unzip python3 && rm -rf /var/cache/apk/*

WORKDIR /app

# 复制主程序代码
COPY server.js .

# 运行阶段：仅保留node运行时，剔除构建冗余
FROM node:20-alpine

# 仅保留运行所需工具
RUN apk update && apk add --no-cache unzip python3 && rm -rf /var/cache/apk/*

# 创建非root用户，避免容器高权限运行
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

WORKDIR /app

# 从构建阶段拷贝代码
COPY --from=builder /app/server.js ./

# 持久化日志目录、临时目录权限
RUN mkdir -p /app/logs /tmp/agent_dir && chmod 777 /tmp /app/logs

# 服务端口
EXPOSE 4567

# 启动命令
CMD ["node", "server.js"]
