FROM node:22-bookworm-slim

# Install LibreOffice and required fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-liberation \
    fonts-noto-core \
    fonts-dejavu-core \
    fonts-freefont-ttf \
    fonts-opensymbol \
    fonts-symbols \
    fonts-lohit-deva \
    fonts-lohit-hindi \
    fonts-sil-abyssinica \
    fonts-sil-nuosu \
    fonts-tlwg-loma \
    xfonts-base \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server.mjs ./server.mjs

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081

USER node

CMD ["node", "server.mjs"]