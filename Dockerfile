FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-online.txt ./
RUN python3 -m venv /opt/reader-venv \
    && /opt/reader-venv/bin/python -m pip install --no-cache-dir -r requirements-online.txt

COPY package.json ./*.mjs fetch-overture.py ./
COPY public ./public

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    OVERTURE_PYTHON=/opt/reader-venv/bin/python \
    PYTHONDONTWRITEBYTECODE=1
EXPOSE 10000
CMD ["node", "server.mjs"]
