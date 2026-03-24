from fastapi import APIRouter, Depends
from schemas import AgentCommandRequest, AgentCommandResponse
from auth import get_current_user

router = APIRouter(prefix="/agent", tags=["agent"])

REMOTE_WRITE_URL = "https://grafana.tbit.co.kr/api/v1/write"


@router.post("/command", response_model=AgentCommandResponse)
def generate_command(req: AgentCommandRequest, user: dict = Depends(get_current_user)):
    csp = req.csp or "onprem"
    region = req.region or "kr"
    env = req.environment or "prod"

    if req.mode == "relay-agent":
        relay_url = req.relay_url or "http://<relay-server-ip>:9999/api/v1/metrics/write"

        linux = (
            f"sudo ./agents/install.sh \\\n"
            f"  --mode=relay-agent \\\n"
            f"  --customer-id={req.customer_id} \\\n"
            f"  --server-name={req.server_name} \\\n"
            f"  --csp={csp} \\\n"
            f"  --region={region} \\\n"
            f"  --environment={env} \\\n"
            f"  --relay-url={relay_url}"
        )

        windows = (
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
            f"sudo ./agents/install.sh \\\n"
            f"  --mode=relay-server \\\n"
            f"  --customer-id={req.customer_id} \\\n"
            f"  --server-name={req.server_name} \\\n"
            f"  --csp={csp} \\\n"
            f"  --region={region} \\\n"
            f"  --environment={env} \\\n"
            f"  --remote-write-url={REMOTE_WRITE_URL}"
        )
        windows = "(relay-server mode is Linux only)"

    else:  # direct
        linux = (
            f"sudo ./agents/install.sh \\\n"
            f"  --mode=direct \\\n"
            f"  --customer-id={req.customer_id} \\\n"
            f"  --server-name={req.server_name} \\\n"
            f"  --csp={csp} \\\n"
            f"  --region={region} \\\n"
            f"  --environment={env} \\\n"
            f"  --remote-write-url={REMOTE_WRITE_URL}"
        )

        windows = (
            f".\\agents\\install.ps1 `\n"
            f"  -Mode direct `\n"
            f"  -CustomerId {req.customer_id} `\n"
            f"  -ServerName {req.server_name} `\n"
            f"  -Csp {csp} `\n"
            f"  -Region {region} `\n"
            f"  -Environment {env} `\n"
            f"  -RemoteWriteUrl {REMOTE_WRITE_URL}"
        )

    return AgentCommandResponse(linux=linux, windows=windows)
