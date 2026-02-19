# Snapshot file
# Unset all aliases to avoid conflicts with functions
# Functions
__systemd_osc_context_common () 
{ 
    if [ -f /etc/machine-id ]; then
        printf ";machineid=%s" "$(< /etc/machine-id)";
    fi;
    printf ";user=%s;hostname=%s;bootid=%s;pid=%s" "$USER" "$HOSTNAME" "$(< /proc/sys/kernel/random/boot_id)" "$$"
}
__systemd_osc_context_escape () 
{ 
    echo "$1" | sed -e 's/\\/\\x5x/g' -e 's/;/\\x3b/g'
}
__systemd_osc_context_precmdline () 
{ 
    local systemd_exitstatus="$?";
    if [ -n "${systemd_osc_context_cmd_id:-}" ]; then
        if [ "$systemd_exitstatus" -ge 127 ]; then
            printf "\033]3008;end=%s;exit=interrupt;signal=%s\033\\" "$systemd_osc_context_cmd_id" $((systemd_exitstatus-127));
        else
            if [ "$systemd_exitstatus" -ne 0 ]; then
                printf "\033]3008;end=%s;exit=failure;status=%s\033\\" "$systemd_osc_context_cmd_id" $((systemd_exitstatus));
            else
                printf "\033]3008;end=%s;exit=success\033\\" "$systemd_osc_context_cmd_id";
            fi;
        fi;
    fi;
    if [ -z "${systemd_osc_context_shell_id:-}" ]; then
        read -r systemd_osc_context_shell_id < /proc/sys/kernel/random/uuid;
    fi;
    printf "\033]3008;start=%s%s;type=shell;cwd=%s\033\\" "$systemd_osc_context_shell_id" "$(__systemd_osc_context_common)" "$(__systemd_osc_context_escape "$PWD")";
    read -r systemd_osc_context_cmd_id < /proc/sys/kernel/random/uuid
}
__systemd_osc_context_ps0 () 
{ 
    [ -n "${systemd_osc_context_cmd_id:-}" ] || return;
    printf "\033]3008;start=%s%s;type=command;cwd=%s\033\\" "$systemd_osc_context_cmd_id" "$(__systemd_osc_context_common)" "$(__systemd_osc_context_escape "$PWD")"
}
gawklibpath_append () 
{ 
    [ -z "$AWKLIBPATH" ] && AWKLIBPATH=`gawk 'BEGIN {print ENVIRON["AWKLIBPATH"]}'`;
    export AWKLIBPATH="$AWKLIBPATH:$*"
}
gawklibpath_default () 
{ 
    unset AWKLIBPATH;
    export AWKLIBPATH=`gawk 'BEGIN {print ENVIRON["AWKLIBPATH"]}'`
}
gawklibpath_prepend () 
{ 
    [ -z "$AWKLIBPATH" ] && AWKLIBPATH=`gawk 'BEGIN {print ENVIRON["AWKLIBPATH"]}'`;
    export AWKLIBPATH="$*:$AWKLIBPATH"
}
gawkpath_append () 
{ 
    [ -z "$AWKPATH" ] && AWKPATH=`gawk 'BEGIN {print ENVIRON["AWKPATH"]}'`;
    export AWKPATH="$AWKPATH:$*"
}
gawkpath_default () 
{ 
    unset AWKPATH;
    export AWKPATH=`gawk 'BEGIN {print ENVIRON["AWKPATH"]}'`
}
gawkpath_prepend () 
{ 
    [ -z "$AWKPATH" ] && AWKPATH=`gawk 'BEGIN {print ENVIRON["AWKPATH"]}'`;
    export AWKPATH="$*:$AWKPATH"
}

# setopts 3
set -o braceexpand
set -o hashall
set -o interactive-comments

# aliases 0

# exports 127
declare -x BAT_THEME="ansi"
declare -x BUN_INSTALL="/tmp/bun-install"
declare -x BUN_TMPDIR="/tmp/bun-tmp"
declare -x CODEX_CI="1"
declare -x CODEX_HOME="/home/b3ngous/projects/vex/src/providers/codex-cli"
declare -x CODEX_MANAGED_BY_NPM="1"
declare -x CODEX_THREAD_ID="019c7721-1602-70e2-aef1-23e5819110bb"
declare -x COLORTERM="truecolor"
declare -x CUDA_PATH="/opt/cuda"
declare -x DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"
declare -x DEBUGINFOD_URLS="https://debuginfod.archlinux.org "
declare -x DESKTOP_SESSION="hyprland-uwsm"
declare -x DISPLAY=":1"
declare -x EDITOR="nvim"
declare -x ELECTRON_OZONE_PLATFORM_HINT="wayland"
declare -x GBM_BACKEND="nvidia-drm"
declare -x GDK_BACKEND="wayland,x11,*"
declare -x GDK_SCALE="1"
declare -x GHOSTTY_BIN_DIR="/usr/bin"
declare -x GHOSTTY_RESOURCES_DIR="/usr/share/ghostty"
declare -x GHOSTTY_SHELL_FEATURES="cursor,path,sudo,title"
declare -x GH_PAGER="cat"
declare -x GIT_PAGER="cat"
declare -x GOBIN="/home/b3ngous/.local/share/mise/installs/go/1.25.4/bin"
declare -x GOROOT="/home/b3ngous/.local/share/mise/installs/go/1.25.4"
declare -x GUM_CONFIRM_PROMPT_FOREGROUND="6"
declare -x GUM_CONFIRM_SELECTED_BACKGROUND="2"
declare -x GUM_CONFIRM_SELECTED_FOREGROUND="0"
declare -x GUM_CONFIRM_UNSELECTED_BACKGROUND="8"
declare -x GUM_CONFIRM_UNSELECTED_FOREGROUND="0"
declare -x HL_INITIAL_WORKSPACE_TOKEN="3204fb0a-40f7-46d2-9d73-94e750be44fc"
declare -x HOME="/home/b3ngous"
declare -x HYPRCURSOR_SIZE="24"
declare -x HYPRLAND_CMD="Hyprland --watchdog-fd 4"
declare -x HYPRLAND_INSTANCE_SIGNATURE="dd220efe7b1e292415bd0ea7161f63df9c95bfd3_1771496069_712237940"
declare -x INPUT_METHOD="fcitx"
declare -x JAVA_HOME="/home/b3ngous/.local/share/mise/installs/java/25.0.1"
declare -x LANG="en_US.UTF-8"
declare -x LANGUAGE
declare -x LC_ADDRESS
declare -x LC_ALL="C.UTF-8"
declare -x LC_COLLATE
declare -x LC_CTYPE="C.UTF-8"
declare -x LC_IDENTIFICATION
declare -x LC_MEASUREMENT
declare -x LC_MESSAGES
declare -x LC_MONETARY
declare -x LC_NAME
declare -x LC_NUMERIC
declare -x LC_PAPER
declare -x LC_TELEPHONE
declare -x LC_TIME
declare -x LIBVA_DRIVER_NAME="nvidia"
declare -x LOGNAME="b3ngous"
declare -x MAIL="/var/spool/mail/b3ngous"
declare -x MANAGERPID="2412"
declare -x MANAGERPIDFDID="2413"
declare -x MEMORY_PRESSURE_WATCH="/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/session.slice/wayland-wm@hyprland.desktop.service/memory.pressure"
declare -x MEMORY_PRESSURE_WRITE="c29tZSAyMDAwMDAgMjAwMDAwMAA="
declare -x MISE_SHELL="bash"
declare -x MOTD_SHOWN="pam"
declare -x MOZ_ENABLE_WAYLAND="1"
declare -x NODE_ENV="test"
declare -x NO_COLOR="1"
declare -x NVCC_CCBIN="/usr/bin/g++"
declare -x NVD_BACKEND="direct"
declare -x OMARCHY_PATH="/home/b3ngous/.local/share/omarchy"
declare -x OMARCHY_SCREENSHOT_DIR="/home/b3ngous/Pictures/screenshots"
declare -x OZONE_PLATFORM="wayland"
declare -x PAGER="cat"
declare -x PASSWORD_STORE_DIR="/home/b3ngous/projects/infraventory/password-store"
declare -x PATH="/home/b3ngous/projects/vex/src/providers/codex-cli/tmp/arg0/codex-arg00OVxU1:/home/b3ngous/.local/share/mise/installs/node/24.10.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/path:/home/b3ngous/.codex/tmp/arg0/codex-arg0AsfrET:/home/b3ngous/.local/share/mise/installs/node/24.10.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/path:/home/b3ngous/.local/share/pnpm:/home/b3ngous/.bun/bin:/home/b3ngous/.local/bin:/home/b3ngous/.local/share/mise/installs/go/1.25.4/bin:/home/b3ngous/.local/share/mise/installs/java/25.0.1/bin:/home/b3ngous/.local/share/mise/installs/just/1.44.0:/home/b3ngous/.local/share/mise/installs/maven/3.9.12/apache-maven-3.9.12/bin:/home/b3ngous/.local/share/mise/installs/node/24.10.0/bin:/home/b3ngous/.local/share/omarchy/bin/:/home/b3ngous/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/opt/cuda/bin:/usr/lib/jvm/default/bin:/usr/bin/site_perl:/usr/bin/vendor_perl:/usr/bin/core_perl"
declare -x PLAYWRIGHT_BROWSERS_PATH="/home/b3ngous/.cache/ms-playwright"
declare -x PNPM_HOME="/home/b3ngous/.local/share/pnpm"
declare -x PNPM_STORE_DIR="/home/b3ngous/.pnpm-store"
declare -x PROJECTS_FOLDER="/home/b3ngous/projects"
declare -x PW_USE_SYSTEM_CHROMIUM="1"
declare -x QT_IM_MODULE="fcitx"
declare -x QT_QPA_PLATFORM="wayland;xcb"
declare -x QT_STYLE_OVERRIDE="kvantum"
declare -x SDL_IM_MODULE="fcitx"
declare -x SDL_VIDEODRIVER="wayland"
declare -x SHELL="/bin/bash"
declare -x SHLVL="2"
declare -x SOPS_AGE_KEY_FILE="/home/b3ngous/projects/infraventory/age/keys.txt"
declare -x SSH_AUTH_SOCK="/run/user/1000/gcr/ssh"
declare -x STARSHIP_SESSION_KEY="2568207742228626"
declare -x STARSHIP_SHELL="bash"
declare -x SUDO_EDITOR=""
declare -x SYSTEMD_EXEC_PID="2624"
declare -x TERM="xterm-ghostty"
declare -x TERMINAL="xdg-terminal-exec"
declare -x TERMINFO="/usr/share/terminfo"
declare -x TERM_PROGRAM="ghostty"
declare -x TERM_PROGRAM_VERSION="1.2.3-arch2"
declare -x TMPDIR="/tmp/bun-tmp"
declare -x USER="b3ngous"
declare -x UWSM_FINALIZE_VARNAMES="HYPRLAND_INSTANCE_SIGNATURE HYPRLAND_CMD HYPRCURSOR_THEME HYPRCURSOR_SIZE XCURSOR_SIZE XCURSOR_THEME"
declare -x UWSM_WAIT_VARNAMES="HYPRLAND_INSTANCE_SIGNATURE"
declare -x WAYLAND_DISPLAY="wayland-1"
declare -x WLR_NO_HARDWARE_CURSORS="1"
declare -x XCOMPOSEFILE="~/.XCompose"
declare -x XCURSOR_SIZE="24"
declare -x XDG_BACKEND="wayland"
declare -x XDG_CACHE_HOME="/home/b3ngous/.cache"
declare -x XDG_CONFIG_DIRS="/etc/xdg"
declare -x XDG_CONFIG_HOME="/home/b3ngous/.config"
declare -x XDG_CURRENT_DESKTOP="Hyprland"
declare -x XDG_DATA_DIRS="/usr/local/share:/usr/share"
declare -x XDG_DATA_HOME="/home/b3ngous/.local/share"
declare -x XDG_MENU_PREFIX="hyprland-"
declare -x XDG_RUNTIME_DIR="/run/user/1000"
declare -x XDG_SEAT="seat0"
declare -x XDG_SEAT_PATH="/org/freedesktop/DisplayManager/Seat0"
declare -x XDG_SESSION_CLASS="user"
declare -x XDG_SESSION_DESKTOP="Hyprland"
declare -x XDG_SESSION_ID="1"
declare -x XDG_SESSION_PATH="/org/freedesktop/DisplayManager/Session0"
declare -x XDG_SESSION_TYPE="wayland"
declare -x XDG_STATE_HOME="/home/b3ngous/.local/state"
declare -x XDG_VTNR="1"
declare -x XMODIFIERS="@im=fcitx"
declare -x _JAVA_AWT_WM_NONREPARENTING="1"
declare -x __GLX_VENDOR_LIBRARY_NAME="nvidia"
declare -x __MISE_DIFF="eAFqXpyfk9KwOC+1vHmpu7+Tp99NM/2M/NxU/STjvPT80mJ9vZz85MQc/eKMxKJU/dzM4lT9zLziksScnGL99Hx9Qz0jUz0T/aTMvGXu/kH+/iE3jUjXvtLLMcwx3sPf1/WmCdG6sxLLEvWNTPUM9AyXFCSWZEwl1+GA3bQgx06Ql0lxbWlxib6hnomJnsFNX6Lty00sS83TN9az1DM00k8sSEzOSNUFi+lCxZIy825aEm1cXn5Kqr6RiZ6hgZ4ByP0Alc+0wA"
declare -x __MISE_ORIG_PATH="/home/b3ngous/.local/share/omarchy/bin/:/home/b3ngous/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/bin:/opt/cuda/bin:/usr/lib/jvm/default/bin:/usr/bin/site_perl:/usr/bin/vendor_perl:/usr/bin/core_perl"
declare -x __MISE_SESSION="eAHqWJOTn5iSmhJfkp+fUzxhHZSXnJ+XlplePPGmmn5Gfm6qfpJxXnp+abG+HkRCPzezOFUfwtYryc/NWQNhxxcklmQUT1icmlfWvNTd38nT76YZmgGA5eQnJ+boF2ckFqVCTMnMKy5JzMkp1k/P1zfUMzLVM9FPysxb5u4f5O8fctOIdO0rvRzDHOM9/H1db5oQrTsrsSxR38hUz0DPcHliTmZicWpxw+KUzKJtqCYUFOVnpSaXFK9JzSuLL0ssis9ILM7YkGRsaZiaZmqQZG6YbGhqYbY2J7EktbgkvrQgJbEk9YgAAxwwzilXWDwTAE6wiUA"
