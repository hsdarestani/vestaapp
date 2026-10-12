FROM python:3.12-alpine
RUN addgroup -S app && adduser -S -G app -u 10001 app
WORKDIR /app
COPY backend/market_server.py /app/market_server.py
USER 10001
EXPOSE 8766
CMD ["python3","/app/market_server.py","--host","0.0.0.0","--port","8766"]
