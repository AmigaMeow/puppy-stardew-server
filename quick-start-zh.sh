#!/bin/bash
# =============================================================================
# Puppy Stardew Server - 快速启动脚本（中文版）
# =============================================================================
# 此脚本将帮助您在几分钟内设置星露谷物语专用服务器！
# =============================================================================

# 不在错误时退出 - 我们手动处理错误
set +e

# 输出颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # 无颜色
BOLD='\033[1m'

# =============================================================================
# 辅助函数
# =============================================================================

print_header() {
    echo ""
    echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}${BOLD}  🐶 小狗星谷服务器 - 快速启动${NC}"
    echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_step() {
    echo ""
    echo -e "${BOLD}$1${NC}"
}

ask_question() {
    echo -e "${CYAN}❓ $1${NC}"
}

# Docker Compose 命令（全局变量，在 check_docker 中设置）
COMPOSE_CMD=""

# =============================================================================
# 主要设置函数
# =============================================================================

check_docker() {
    print_step "步骤 1: 检查 Docker 安装..."

    if ! command -v docker &> /dev/null; then
        print_error "Docker 未安装！"
        echo ""
        echo "请运行以下命令安装 Docker："
        echo -e "  ${CYAN}curl -fsSL https://get.docker.com | sh${NC}"
        echo ""
        echo "其他系统请访问: https://docs.docker.com/get-docker/"
        echo ""
        exit 1
    fi

    if ! docker ps &> /dev/null; then
        print_error "Docker 守护进程未运行或需要 sudo 权限！"
        echo ""
        echo "尝试以下方法之一："
        echo -e "  1. 启动 Docker: ${CYAN}sudo systemctl start docker${NC}"
        echo -e "  2. 将用户添加到 docker 组: ${CYAN}sudo usermod -aG docker \$USER${NC}"
        echo "     (然后注销并重新登录)"
        echo ""
        exit 1
    fi

    # 检测 Docker Compose 可用性
    if docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
        print_success "Docker 已安装并正在运行！（Docker Compose v2）"
    elif command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
        print_success "Docker 已安装并正在运行！（Docker Compose v1）"
    else
        # 尝试自动安装 docker-compose-plugin
        print_warning "Docker Compose 未安装，正在尝试自动安装..."
        echo ""

        INSTALL_SUCCESS=false

        # 方法 1: apt (Ubuntu/Debian)
        if command -v apt-get &> /dev/null; then
            print_info "检测到 apt 包管理器，正在安装 docker-compose-plugin..."
            if apt-get update -qq &> /dev/null && apt-get install -y -qq docker-compose-plugin &> /dev/null; then
                INSTALL_SUCCESS=true
            fi
        fi

        # 方法 2: yum (CentOS/RHEL)
        if [ "$INSTALL_SUCCESS" = "false" ] && command -v yum &> /dev/null; then
            print_info "检测到 yum 包管理器，正在安装 docker-compose-plugin..."
            if yum install -y docker-compose-plugin &> /dev/null; then
                INSTALL_SUCCESS=true
            fi
        fi

        # 方法 3: dnf (Fedora)
        if [ "$INSTALL_SUCCESS" = "false" ] && command -v dnf &> /dev/null; then
            print_info "检测到 dnf 包管理器，正在安装 docker-compose-plugin..."
            if dnf install -y docker-compose-plugin &> /dev/null; then
                INSTALL_SUCCESS=true
            fi
        fi

        # 验证安装结果
        if [ "$INSTALL_SUCCESS" = "true" ] && docker compose version &> /dev/null; then
            COMPOSE_CMD="docker compose"
            print_success "Docker Compose 已自动安装成功！"
        else
            # 自动安装失败，给出具体的手动安装命令
            print_error "Docker Compose 自动安装失败！"
            echo ""
            print_info "请手动运行以下命令安装："
            echo ""
            if command -v apt-get &> /dev/null; then
                echo -e "  ${CYAN}sudo apt-get update && sudo apt-get install -y docker-compose-plugin${NC}"
            elif command -v yum &> /dev/null; then
                echo -e "  ${CYAN}sudo yum install -y docker-compose-plugin${NC}"
            else
                echo -e "  ${CYAN}sudo apt-get update && sudo apt-get install -y docker-compose-plugin${NC}"
            fi
            echo ""
            echo "安装完成后，重新运行此脚本即可。"
            echo ""
            exit 1
        fi
    fi
}

download_files() {
    print_step "步骤 2: 下载配置文件..."

    if [ ! -d "puppy-stardew-server" ]; then
        print_info "克隆仓库..."
        if git clone https://github.com/AmigaMeow/puppy-stardew-server.git; then
            print_success "仓库已克隆！"
        else
            print_error "克隆失败！请检查网络连接。"
            exit 1
        fi
    else
        print_info "目录已存在，跳过克隆"
    fi

    cd puppy-stardew-server || exit 1
}

configure_steam() {
    print_step "步骤 3: Steam 配置..."
    echo ""
    print_warning "重要：您必须在 Steam 上拥有星露谷物语！"
    print_info "游戏文件将通过您的 Steam 账户下载。"
    echo ""

    if [ -f ".env" ]; then
        ask_question ".env 文件已存在。是否要重新配置？(y/n)"
        read -r reconfigure </dev/tty
        if [[ ! $reconfigure =~ ^[Yy]$ ]]; then
            print_info "使用现有 .env 文件"
            return
        fi
    fi

    cp .env.example .env

    echo ""
    print_info "═══════════════════════════════════════════════════"
    print_info "  配置方式选择"
    print_info "═══════════════════════════════════════════════════"
    echo ""
    ask_question "是否在终端手动输入配置信息？(y/n)"
    echo -e "${CYAN}  y${NC} - 现在在终端输入 Steam 用户名、密码和 VNC 密码"
    echo -e "${CYAN}  n${NC} - 稍后手动编辑 .env 文件（推荐熟悉 Linux 用户）"
    echo ""
    read -r manual_input </dev/tty

    if [[ $manual_input =~ ^[Yy]$ ]]; then
        # 手动输入模式
        echo ""
        ask_question "请输入您的 Steam 用户名："
        read -r steam_username </dev/tty

        echo ""
        ask_question "请输入您的 Steam 密码（输入时不会显示，直接输入后按回车）："
        read -rs steam_password </dev/tty
        echo ""

        echo ""
        ask_question "请输入 VNC 密码（最多8个字符，按回车自动生成随机密码）："
        read -r vnc_password </dev/tty
        if [ -z "$vnc_password" ]; then
            vnc_password="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom 2>/dev/null | head -c 8)"
            print_info "已生成随机 VNC 密码：${vnc_password}"
            print_info "请立即保存——连接 VNC 时需要它。"
        fi

        # 验证并截断 VNC 密码为 8 个字符
        if [ ${#vnc_password} -gt 8 ]; then
            print_warning "VNC 密码超过 8 个字符！"
            print_warning "VNC 协议会自动截断为 8 个字符。"
            vnc_password="${vnc_password:0:8}"
        fi

        # 更新 .env 文件
        sed -i "s/^STEAM_USERNAME=.*/STEAM_USERNAME=$steam_username/" .env
        sed -i "s/^STEAM_PASSWORD=.*/STEAM_PASSWORD=$steam_password/" .env
        sed -i "s/^VNC_PASSWORD=.*/VNC_PASSWORD=$vnc_password/" .env

        print_success "Steam 配置已保存！"
    else
        # 手动编辑 .env 文件模式
        echo ""
        print_info "请手动编辑 .env 文件来配置您的凭证："
        echo -e "  ${CYAN}nano .env${NC}  或  ${CYAN}vim .env${NC}"
        echo ""
        print_info "需要配置以下字段："
        echo -e "  ${YELLOW}STEAM_USERNAME${NC}  - 您的 Steam 用户名"
        echo -e "  ${YELLOW}STEAM_PASSWORD${NC}  - 您的 Steam 密码"
        echo -e "  ${YELLOW}VNC_PASSWORD${NC}    - VNC 访问密码（最多8个字符）"
        echo ""
        ask_question "配置完成后，按回车继续..."
        read -r </dev/tty
    fi
}

setup_directories() {
    print_step "步骤 4: 设置数据目录..."

    # 创建目录（包括日志监控需要的 logs 目录）
    mkdir -p data/{saves,game,steam,logs,backups,custom-mods,panel}

    print_info "设置正确的权限 (UID 1000)..."
    if chown -R 1000:1000 data/ 2>/dev/null; then
        # 验证权限是否正确设置
        if [ "$(stat -c '%u' data/game 2>/dev/null || stat -f '%u' data/game 2>/dev/null)" != "1000" ]; then
            print_error "权限设置失败！"
            print_error "这将导致下载游戏文件时出现'磁盘写入失败'错误。"
            echo ""
            echo "请手动运行: sudo chown -R 1000:1000 data/"
            echo ""
            exit 1
        fi
        print_success "目录已创建并设置权限！"
    else
        print_warning "无法设置权限，尝试使用 sudo..."
        if sudo chown -R 1000:1000 data/; then
            print_success "目录已创建并设置权限！"
        else
            print_error "设置权限失败！"
            print_error "这将导致下载游戏文件时出现'磁盘写入失败'错误。"
            echo ""
            echo "请手动运行: sudo chown -R 1000:1000 data/"
            echo ""
            exit 1
        fi
    fi
}

start_server() {
    print_step "步骤 5: 启动服务器..."
    echo ""

    print_info "拉取 Docker 镜像（可能需要几分钟）..."
    echo ""
    # 显示拉取进度
    if $COMPOSE_CMD pull; then
        print_success "镜像拉取完成！"
    else
        print_warning "拉取镜像时出现错误，尝试启动..."
    fi

    echo ""
    print_info "启动服务器..."
    if $COMPOSE_CMD up -d; then
        print_success "服务器已启动！"
    else
        print_error "启动失败！"
        echo ""
        echo "查看日志以了解详情:"
        echo -e "  ${CYAN}$COMPOSE_CMD logs${NC}"
        exit 1
    fi

    # 等待初始化容器完成
    print_info "等待初始化容器完成..."
    for i in {1..30}; do
        INIT_STATUS=$(docker inspect --format='{{.State.Status}}' puppy-stardew-init 2>/dev/null)
        if [ "$INIT_STATUS" = "exited" ]; then
            INIT_EXIT=$(docker inspect --format='{{.State.ExitCode}}' puppy-stardew-init 2>/dev/null)
            if [ "$INIT_EXIT" = "0" ]; then
                print_success "初始化容器已完成！"
                break
            else
                print_error "初始化容器失败（退出码：$INIT_EXIT）！"
                echo "查看日志: docker logs puppy-stardew-init"
                exit 1
            fi
        fi
        sleep 1
    done

    print_info "等待服务器初始化（5秒）..."
    sleep 5

    if docker ps | grep -q puppy-stardew; then
        print_success "服务器正在运行！"
    else
        print_error "容器启动失败！"
        echo ""
        echo "查看日志:"
        echo -e "  ${CYAN}docker logs puppy-stardew${NC}"
        exit 1
    fi
}

get_server_ip() {
    # 尝试获取公网 IP
    if command -v curl &> /dev/null; then
        public_ip=$(curl -4 -s ifconfig.me 2>/dev/null || curl -4 -s ip.sb 2>/dev/null || echo "")
        if [ -n "$public_ip" ]; then
            echo "$public_ip"
            return
        fi
    fi

    # 回退到本地 IP
    if command -v hostname &> /dev/null; then
        hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip"
    else
        echo "your-server-ip"
    fi
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}${BOLD}🎉 设置完成！接下来该做什么：${NC}"
    echo ""

    echo -e "${BOLD}1. 监控下载进度：${NC}"
    echo "   docker logs -f puppy-stardew"
    echo ""
    echo -e "${YELLOW}   首次启动将下载约 1.5GB 游戏文件。${NC}"
    echo -e "${YELLOW}   根据您的网络速度，通常需要 5-15 分钟。${NC}"
    echo ""

    echo -e "${BOLD}2. 如果启用了 Steam 令牌：${NC}"
    echo "   - 检查日志中是否有要求输入令牌代码的消息："
    echo -e "     ${CYAN}docker logs puppy-stardew | grep -i \"steam guard\"${NC}"
    echo "   - 如果看到 \"Steam Guard code:\" 提示，附加到容器："
    echo -e "     ${CYAN}docker attach puppy-stardew${NC}"
    echo "   - 输入从邮件/手机应用获取的 Steam 令牌代码并按回车"
    echo -e "   - ${YELLOW}重要：${NC}输入后等待3-5秒，确认开始下载游戏"
    echo -e "   - 然后按 ${YELLOW}Ctrl+P Ctrl+Q${NC} 分离（${RED}不要按 Ctrl+C！${NC}）"
    echo ""

    echo -e "${BOLD}3. 🌐 Web 管理面板（推荐）：${NC}"
    echo -e "   - 浏览器访问: ${CYAN}http://$(get_server_ip):18642${NC}"
    echo "   - 首次访问会引导你创建管理密码"
    echo "   - 功能: 实时状态、日志查看、终端控制、配置、存档、模组管理"
    echo ""

    echo -e "${BOLD}4. 可选的 VNC 初始设置（仅在需要手动进游戏时使用）：${NC}"
    echo "   - 下载 VNC 客户端（RealVNC、TightVNC 等）"
    echo -e "   - 连接到: ${CYAN}$(get_server_ip):5900${NC}"
    _vnc_pw="$(grep '^VNC_PASSWORD=' .env 2>/dev/null | cut -d'=' -f2)"
    if [ -n "$_vnc_pw" ]; then
        echo -e "   - 密码: ${CYAN}${_vnc_pw}${NC}"
    else
        echo -e "   - 密码: ${CYAN}启动时自动生成${NC}（用 docker exec <容器> cat /home/steam/web-panel/data/vnc_password.txt 读取）"
    fi
    echo "   - 如果你想手动在游戏内创建新存档，可以使用 VNC"
    echo "   - 或者直接在 Web 面板上传现有存档并设为默认自动加载"
    echo ""

    echo -e "${BOLD}5. 玩家可以连接：${NC}"
    echo "   - 打开星露谷物语"
    echo '   - 点击 "合作" → "加入局域网游戏"'
    echo "   - 服务器会自动显示，或手动输入服务器 IP"
    echo -e "   ${YELLOW}⚠️  注意：只需输入 IP，端口 24642 是默认的无需指定${NC}"
    echo ""

    echo -e "${BOLD}常用命令：${NC}"
    echo -e "   查看日志:        ${CYAN}docker logs -f puppy-stardew${NC}"
    echo -e "   重启服务器:      ${CYAN}$COMPOSE_CMD down && $COMPOSE_CMD up -d${NC}"
    echo -e "   停止服务器:      ${CYAN}$COMPOSE_CMD down${NC}"
    echo -e "   检查健康:        ${CYAN}./health-check.sh${NC}"
    echo -e "   备份存档:        ${CYAN}./backup.sh${NC}"
    echo ""
    echo -e "${YELLOW}   ⚠️  注意: 修改 .env 后必须重启才能生效！${NC}"
    echo ""

    echo -e "${GREEN}${BOLD}🌟 享受您的即时睡眠星露谷服务器！${NC}"
    echo ""

    # 智能检测是否需要 Steam Guard 验证码
    echo ""
    print_info "正在检测服务器状态..."
    sleep 2

    NEEDS_STEAM_GUARD=false
    RECENT_LOGS=$(docker logs --tail 50 puppy-stardew 2>&1 || true)
    if echo "$RECENT_LOGS" | grep -qi "steam guard\|two-factor\|two factor\|auth code\|verification code\|Enter the current code"; then
        NEEDS_STEAM_GUARD=true
    fi

    if [ "$NEEDS_STEAM_GUARD" = "true" ]; then
        echo ""
        print_warning "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        print_warning "  检测到 Steam 需要验证码！"
        print_warning "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        print_info "您需要附加到容器来输入 Steam Guard 验证码。"
        print_info "请按以下步骤操作："
        echo ""
        echo -e "  ${CYAN}1.${NC} 运行: ${CYAN}docker attach puppy-stardew${NC}"
        echo -e "  ${CYAN}2.${NC} 输入邮件/手机应用中收到的验证码，按回车"
        echo -e "  ${CYAN}3.${NC} 等待 3-5 秒确认游戏开始下载"
        echo -e "  ${CYAN}4.${NC} 按 ${YELLOW}Ctrl+P Ctrl+Q${NC} 分离容器（${RED}不要按 Ctrl+C！${NC}）"
        echo ""
    else
        echo ""
        ask_question "请选择下一步操作："
        echo -e "  ${CYAN}1${NC} - 查看实时日志: ${CYAN}docker logs -f puppy-stardew${NC}"
        echo -e "  ${CYAN}2${NC} - 附加到容器（可交互输入验证码）: ${CYAN}docker attach puppy-stardew${NC}"
        echo ""
        print_info "您可以直接复制上方命令在终端执行。"
    fi
}

# =============================================================================
# 主流程
# =============================================================================

main() {
    print_header
    check_docker
    download_files
    configure_steam
    setup_directories
    start_server
    print_next_steps
}

# 运行主函数
main
