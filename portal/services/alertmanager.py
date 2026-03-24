import os
import yaml
from services.docker_mgr import restart_container

CONFIG_DIR = os.getenv("CONFIG_DIR", "/monitoring_msp/config")


def get_alertmanager_config_path() -> str:
    path = os.path.join(CONFIG_DIR, "alertmanager", "alertmanager.yml")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def generate_alertmanager_config(customers: list[dict]) -> str:
    """
    customers: [{ customer_id, emails: [str] }]
    """
    smtp_user = os.getenv("SMTP_USER") or os.getenv("SMTP_USERNAME", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "alertmanager@tbit.co.kr")
    smtp_host = os.getenv("SMTP_HOST", "smtp.worksmobile.com")
    smtp_port = os.getenv("SMTP_PORT", "587")

    config = {
        "global": {
            "smtp_smarthost": f"{smtp_host}:{smtp_port}",
            "smtp_from": smtp_from,
            "smtp_auth_username": smtp_user,
            "smtp_auth_password": smtp_password,
            "smtp_require_tls": True,
        },
        "route": {
            "receiver": "blackhole",
            "group_by": ["customer_id", "alertname"],
            "group_wait": "30s",
            "group_interval": "5m",
            "repeat_interval": "4h",
            "routes": [],
        },
        "receivers": [{"name": "blackhole"}],
    }

    for customer in customers:
        active_emails = [e for e in customer.get("emails", []) if e]
        if not active_emails:
            continue

        receiver_name = f"customer-{customer['customer_id']}"
        config["route"]["routes"].append({
            "match": {"customer_id": customer["customer_id"]},
            "receiver": receiver_name,
        })
        config["receivers"].append({
            "name": receiver_name,
            "email_configs": [
                {"to": email, "send_resolved": True}
                for email in active_emails
            ],
        })

    return yaml.dump(config, default_flow_style=False, allow_unicode=True)


async def apply_alertmanager_config(customers: list[dict]) -> bool:
    path = get_alertmanager_config_path()
    content = generate_alertmanager_config(customers)
    with open(path, "w") as f:
        f.write(content)
    return await restart_container("msp-alertmanager")
