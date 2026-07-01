# 构建阶段
FROM node:20-alpine AS builder
RUN apk update && apk add --no-cache unzip python3 make g++ && rm -rf /var/cache/apk/*
WORKDIR /app
COPY index.js .

# 运行阶段
FROM node:20-alpine
RUN apk update && apk add --no-cache unzip python3 make g++ && rm -rf /var/cache/apk/*

# 创建用户与目录
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /app/logs /tmp/agent_dir \
    && chmod -R 777 /tmp /app/logs

USER appuser
WORKDIR /app
COPY --from=builder /app/index.js ./

EXPOSE 3000
CMD ["node", "index.js"]
