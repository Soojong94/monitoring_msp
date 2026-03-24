from fastapi import APIRouter, Depends
from schemas import AgentCommandRequest, AgentCommandResponse
from auth import get_current_user

router = APIRouter(prefix="/agent", tags=["agent"])

REMOTE_WRITE_URL = "https://grafana.tbit.co.kr/api/v1/write"
REPO_URL = "https://github.com/Soojong94/monitoring_msp.git"


@router.post("/command", response_model=AgentCommandResponse)
def generate_command(req: AgentCommandRequest, user: dict = Depends(get_current_user)):
    csp = req.csp or "onprem"
    region = req.region or "kr"
    env = req.environment or "prod"

    if req.mode == "relay-agent":
        relay_url = req.relay_url or "http://<relay-server-ip>:9999/api/v1/metrics/write"

        linux = (
            f"# 1. 레포 클론 (git 없으면 curl로 install.sh만 받아도 됨)\n"
            f"git clone {REPO_URL} && cd monitoring_msp\n\n"
            f"# 2. 설치\n"
            f"sudo bash agents/install.sh \\\n"
            f"  --mode=relay-agent \\\n"
            f"  --customer-id={req.customer_id} \\\n"
            f"  --server-name={req.server_name} \\\n"
            f"  --csp={csp} \\\n"
            f"  --region={region} \\\n"
            f"  --environment={env} \\\n"
            f"  --relay-url={relay_url}"
        )

        windows = (
            f"# 관리자 PowerShell에서 실행\n\n"
            f"# 1. 레포 클론\n"
            f"git clone {REPO_URL}\n"
            f"cd monitoring_msp\n\n"
            f"# 2. 설치\n"
            f".\\agents\\install.ps1 `\n"
            f"  -Mode relay-agent `\n"
            f"  -CustomerId {req.customer_id} `\n"
            f"  -ServerName {req.server_name} `\n"
            f"  -Csp {csp} `\n"
            f"  -Region {region} `\n"
            f"  -Environment {env} `\n"
            f"  -RelayUrl {relay_url}"
        )

    elif req.mode == "relay-server":
        linux = (
            f"# 1. 레포 클론\n"
            f"git clone {REPO_URL} && cd monitoring_msp\n\n"
            f"# 2. 설치\n"
            f"sudo bash agents/install.sh \\\n"
            f"  --mode=relay-server \\\n"
            f"  --customer-id={req.customer_id} \\\n"
            f"  --server-name={req.server_name} \\\n"
            f"  --csp={csp} \\\n"
            f"  --region={region} \\\n"
            f"  --environment={env} \\\n"
            f"  --remote-write-url={REMOTE_WRITE_URL}\n\n"
            f"# 3. 방화벽 (relay-agent들이 접근할 수 있도록)\n"
            f"ufw allow 9999/tcp  # Ubuntu\n"
            f"# firewall-cmd --permanent --add-port=9999/tcp && firewall-cmd --reload  # Rocky/CentOS"
        )
        windows = "# relay-server 모드는 Linux 전용입니다.\n# Windows 서버는 direct 또는 relay-agent 모드를 사용하세요."

    else:  # direct
        linux = (
            f"# 1. 레포 클론\n"
            f"git clone {REPO_URL} && cd monitoring_msp\n\n"
            f"# 2. 설치\n"
            f"sudo bash agents/install.sh \\\n"
            f"  --mode=direct \\\n"
            f"  --customer-id={req.customer_id} \\\n"
            f"  --server-name={req.server_name} \\\n"
            f"  --csp={csp} \\\n"
            f"  --region={region} \\\n"
            f"  --environment={env} \\\n"
            f"  --remote-write-url={REMOTE_WRITE_URL}\n\n"
            f"# 3. 설치 확인\n"
            f"systemctl status alloy"
        )

        windows = (
            f"# 관리자 PowerShell에서 실행\n\n"
            f"# 1. 레포 클론\n"
            f"git clone {REPO_URL}\n"
            f"cd monitoring_msp\n\n"
            f"# 2. 설치 (Alloy + WinSW 서비스 래퍼 자동 다운로드)\n"
            f".\\agents\\install.ps1 `\n"
            f"  -Mode direct `\n"
            f"  -CustomerId {req.customer_id} `\n"
            f"  -ServerName {req.server_name} `\n"
            f"  -Csp {csp} `\n"
            f"  -Region {region} `\n"
            f"  -Environment {env} `\n"
            f"  -RemoteWriteUrl {REMOTE_WRITE_URL}\n\n"
            f"# 3. 설치 확인\n"
            f"Get-Service GrafanaAlloy\n"
            f"Get-Content 'C:\\ProgramData\\GrafanaAlloy\\logs\\alloy-service.out.log' -Tail 20"
        )

    return AgentCommandResponse(linux=linux, windows=windows)
