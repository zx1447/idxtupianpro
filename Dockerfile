# 下载并解压 nezha-agent，强制校验文件是否存在
RUN arch=$(uname -m) && \
    case "$arch" in \
        x86_64) ARCH=amd64 ;; \
        aarch64) ARCH=arm64 ;; \
        armv7l) ARCH=arm ;; \
        *) ARCH=amd64 ;; \
    esac && \
    echo "当前架构:$ARCH" && \
    curl -fsSL --connect-timeout 15 -o /tmp/agent.zip "https://github.com/nezhahq/agent/releases/latest/download/nezha-agent_linux_${ARCH}.zip" && \
    unzip -o /tmp/agent.zip -d /tmp/agent/ && \
    # 把解压出来的二进制移动到 /usr/local/bin
    mv /tmp/agent/nezha-agent /usr/local/bin/ && \
    chmod +x /usr/local/bin/nezha-agent && \
    # 校验文件存在，不存在直接构建失败
    test -f /usr/local/bin/nezha-agent || exit 1 && \
    rm -rf /tmp/agent /tmp/agent.zip
