FROM ubuntu:22.04

# systemd + 기본 도구 설치
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        systemd systemd-sysv dbus curl git && \
    rm -rf /var/lib/apt/lists/* && \
    # 불필요한 systemd 유닛 제거 (컨테이너 환경)
    find /etc/systemd/system /lib/systemd/system \
        -path '*.wants/*' \
        \( -name '*getty*' -o -name '*plymouth*' \
           -o -name '*fstab*' -o -name '*swap*' \) \
        -delete

STOPSIGNAL SIGRTMIN+3
CMD ["/usr/lib/systemd/systemd"]
