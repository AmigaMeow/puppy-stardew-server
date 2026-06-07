# Puppy Stardew Server - Public Version
# 小狗星谷服务器 - 公开版本
#
# This Docker image does NOT include the game files.
# Users must provide their own Steam credentials to download Stardew Valley.
# 此镜像不包含游戏本体文件。
# 用户需要提供自己的 Steam 账号来下载星露谷物语。

FROM ubuntu:22.04

# Prevent interactive prompts during installation
# 避免安装过程中的交互提示
ENV DEBIAN_FRONTEND=noninteractive

LABEL maintainer="truemanlive" \
      description="Stardew Valley dedicated server with auto-pause and instant sleep" \
      version="1.1.0"

# Install all dependencies in a single layer and clean up
# 在单层中安装所有依赖并清理
RUN dpkg --add-architecture i386 && \
    apt-get update && apt-get install -y --no-install-recommends \
    # Core tools
    wget curl unzip ca-certificates \
    # SteamCMD dependencies
    lib32gcc-s1 libcurl3-gnutls:i386 \
    # Game rendering
    libsdl2-2.0-0 \
    libgl1-mesa-dri libgl1-mesa-glx libegl1-mesa \
    # X11 display
    xserver-xorg-core xserver-xorg-video-modesetting \
    x11-xserver-utils xvfb x11vnc openbox xdotool \
    # Runtime
    dotnet-runtime-6.0 \
    # Utilities
    procps net-tools \
    # Node.js for web panel
    nodejs npm \
    && \
    # Clean up apt cache in same layer to reduce image size
    # 在同一层清理 apt 缓存以减小镜像大小
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* \
           /usr/share/doc/* /usr/share/man/* /usr/share/info/* \
           /usr/share/lintian/* /usr/share/locale/* \
           /tmp/* /var/tmp/*

# Create non-root user and Xorg config in single layer
# 在单层中创建用户和 Xorg 配置
RUN useradd -m -s /bin/bash steam && \
    mkdir -p /home/steam/steamcmd /home/steam/stardewvalley \
             /home/steam/.config/StardewValley /home/steam/scripts && \
    chown -R steam:steam /home/steam && \
    (usermod -aG video steam || true) && \
    # Xorg modesetting config for GPU acceleration
    mkdir -p /etc/X11/xorg.conf.d && \
    cat > /etc/X11/xorg.conf.d/20-modesetting.conf <<'EOF'
Section "Device"
  Identifier "IntelGPU0"
  Driver "modesetting"
  Option "AccelMethod" "glamor"
  Option "DRI" "3"
EndSection
EOF

# Set working directory and switch to steam user
WORKDIR /home/steam
USER steam

# Download SteamCMD and SMAPI in a single layer, clean up downloads
# 在单层中下载 SteamCMD 和 SMAPI，清理下载文件
RUN wget -qO- 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz' | \
    tar zxvf - -C /home/steam/steamcmd && \
    wget -qO smapi.zip 'https://github.com/Pathoschild/SMAPI/releases/download/4.3.2/SMAPI-4.3.2-installer.zip' && \
    unzip -q smapi.zip -d smapi && \
    rm smapi.zip

# Copy pre-configured mods to a temporary location
# 将预配置的模组复制到临时位置
USER root
COPY mods/ /home/steam/preinstalled-mods/
RUN chown -R steam:steam /home/steam/preinstalled-mods && \
    chmod -R 755 /home/steam/preinstalled-mods
USER steam

# Copy scripts
# 复制脚本：entrypoint 到主目录，其余到 scripts/
COPY --chown=steam:steam scripts/entrypoint.sh /home/steam/entrypoint.sh
COPY --chown=steam:steam scripts/auto-backup.sh scripts/auto-enable-server.sh \
     scripts/auto-handle-passout.sh scripts/auto-handle-readycheck.sh \
     scripts/auto-reconnect-server.sh scripts/crash-monitor.sh \
     scripts/event-handler.sh scripts/init-container.sh scripts/key-lock.sh \
     scripts/log-manager.sh scripts/log-monitor.sh scripts/player-access.sh \
     scripts/save-selector.sh scripts/set-resolution.sh scripts/status-reporter.sh \
     scripts/view-logs.sh scripts/vnc-monitor.sh \
     /home/steam/scripts/
RUN chmod +x /home/steam/entrypoint.sh /home/steam/scripts/*.sh

# Copy config files
# 复制配置文件
COPY --chown=steam:steam config/startup_preferences /home/steam/startup_preferences.template
COPY --chown=steam:steam config/10-monitor.conf /etc/X11/xorg.conf.d/10-monitor.conf

# Copy web panel and install dependencies
# 复制 Web 管理面板并安装依赖
COPY --chown=steam:steam web-panel/ /home/steam/web-panel/
RUN cd /home/steam/web-panel && npm ci --only=production && \
    chown -R steam:steam /home/steam/web-panel

# Run as root to allow permission fixes on startup
# 以 root 身份运行以允许启动时修复权限
USER root

# Expose game port (UDP), VNC port (TCP), metrics port (TCP), and web panel port (TCP)
# 暴露游戏端口（UDP）、VNC 端口（TCP）、指标端口（TCP）和 Web 面板端口（TCP）
EXPOSE 24642/udp 5900/tcp 9090/tcp 18642/tcp

# Health check to ensure server is running
# 健康检查确保服务器正在运行
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD pgrep -f "StardewModdingAPI" > /dev/null || exit 1

# Set entrypoint
# 设置启动脚本
ENTRYPOINT ["/home/steam/entrypoint.sh"]
