FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY services/recommendation-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY services/recommendation-service/ .
COPY shared/ ./shared/

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8002/health || exit 1

CMD ["python", "main.py"]
