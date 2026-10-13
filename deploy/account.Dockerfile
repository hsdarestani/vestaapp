FROM python:3.12-alpine
RUN addgroup -S app && adduser -S -G app -u 10001 app
WORKDIR /app
COPY backend/account_server.py /app/account_server.py
COPY backend/bazaar_verify.py /app/bazaar_verify.py
USER 10001
EXPOSE 8777
CMD ["python3","/app/account_server.py","--host","0.0.0.0","--port","8777"]
