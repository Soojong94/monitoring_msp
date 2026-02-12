.PHONY: help build up local down restart logs ps health setup clean

LOCAL_COMPOSE = docker compose -f docker-compose.yml -f docker-compose.local.yml --env-file .env.local

help: ## 사용 가능한 명령어 목록
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## 프로덕션 이미지 빌드
	docker compose build

up: ## 프로덕션 모드 실행
	docker compose up -d

local-build: ## 로컬 테스트 이미지 빌드
	$(LOCAL_COMPOSE) build

local: ## 로컬 테스트 모드 실행 (Mock 데이터)
	$(LOCAL_COMPOSE) up -d

down: ## 전체 스택 중지
	$(LOCAL_COMPOSE) down 2>/dev/null; docker compose down 2>/dev/null; true

restart: ## 재시작
	$(LOCAL_COMPOSE) restart

logs: ## 전체 서비스 로그
	$(LOCAL_COMPOSE) logs -f --tail=50

ps: ## 서비스 상태 확인
	$(LOCAL_COMPOSE) ps

health: ## 헬스 체크
	@bash scripts/health-check.sh

clean: ## 컨테이너 + 볼륨 정리
	$(LOCAL_COMPOSE) down -v 2>/dev/null; docker compose down -v 2>/dev/null; true
