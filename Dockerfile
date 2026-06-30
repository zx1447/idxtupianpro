FROM node:22-alpine

# 安装依赖：unzip、python3、bash、procps
RUN apk update && apk add --no-cache unzip python3 bash procps

# 工作目录
WORKDIR /app

# 拷贝项目文件（如果你后续加package.json也能兼容）
COPY . .

# 暴露端口
EXPOSE 4567

# 启动命令
CMD ["node", "index.js"]
