FROM node:22-alpine

# 安装依赖：unzip、python3、bash、procps
RUN apk update && apk add --no-cache unzip python3 bash procps

# 工作目录（容器内只读目录，不放临时文件）
WORKDIR /app

# 拷贝代码到容器
COPY index.js /app/index.js

# 暴露端口
EXPOSE 4567

# 启动命令
CMD ["node", "index.js"]
