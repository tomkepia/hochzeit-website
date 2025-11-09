#!/bin/bash

# SSL Certificate Setup Script using Let's Encrypt
# Usage: ./setup-ssl.sh yourdomain.com your-email@example.com

set -e

DOMAIN=${1:-yourdomain.com}
EMAIL=${2:-your-email@example.com}

if [ "$DOMAIN" = "yourdomain.com" ] || [ "$EMAIL" = "your-email@example.com" ]; then
    echo "❌ Error: Please provide your actual domain and email"
    echo "Usage: $0 <domain> <email>"
    echo "Example: $0 hochzeit-tomke-jp.de contact@example.com"
    exit 1
fi

echo "🔐 Setting up SSL certificate for $DOMAIN..."

# Navigate to project directory
cd /opt/hochzeit-website

# Update domain in nginx configuration
echo "📝 Updating nginx configuration with domain: $DOMAIN"
sed -i "s/yourdomain.com/$DOMAIN/g" nginx/conf.d/default.conf

# Update environment variables
echo "⚙️ Updating environment variables..."
sed -i "s/yourdomain.com/$DOMAIN/g" .env.production
sed -i "s/your-email@example.com/$EMAIL/g" .env.production

# Create initial nginx config for HTTP (for certificate challenge)
echo "🌐 Starting nginx for initial certificate request..."
cat > nginx/conf.d/default.conf << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}
EOF

# Start nginx temporarily for certificate generation
docker-compose -f docker-compose.prod.yml up -d nginx

# Wait for nginx to be ready
sleep 10

# Request SSL certificate
echo "📜 Requesting SSL certificate from Let's Encrypt..."
docker-compose -f docker-compose.prod.yml run --rm certbot \
    certonly --webroot --webroot-path /var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN -d www.$DOMAIN

# Update nginx config to full HTTPS configuration
echo "🔒 Updating nginx configuration for HTTPS..."
cat > nginx/conf.d/default.conf << 'EOF'
# HTTP redirect to HTTPS
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;
    
    # Certbot challenge location
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server configuration
server {
    listen 443 ssl http2;
    server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;
    
    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # HSTS (optional)
    add_header Strict-Transport-Security "max-age=31536000" always;

    # API routes to backend
    location /api {
        # Remove /api prefix when forwarding to backend
        rewrite ^/api(.*)$ $1 break;
        
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Rate limiting for API
        limit_req zone=api burst=20 nodelay;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Special rate limiting for RSVP endpoint
    location /api/rsvp {
        rewrite ^/api(.*)$ $1 break;
        
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Stricter rate limiting for form submissions
        limit_req zone=login burst=5 nodelay;
    }

    # Frontend static files
    location / {
        proxy_pass http://frontend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            proxy_pass http://frontend;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Security headers for specific locations
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        proxy_pass http://frontend;
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options nosniff;
    }
}
EOF

# Replace domain placeholder
sed -i "s/DOMAIN_PLACEHOLDER/$DOMAIN/g" nginx/conf.d/default.conf

# Restart services with full configuration
echo "🔄 Restarting services..."
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d

# Test certificate
echo "🧪 Testing SSL certificate..."
sleep 15
if curl -sf https://$DOMAIN >/dev/null; then
    echo "✅ SSL certificate successfully installed and working!"
else
    echo "⚠️ SSL might not be working yet. Check logs with: docker-compose -f docker-compose.prod.yml logs nginx"
fi

echo "🎉 SSL setup completed for $DOMAIN!"
echo "📋 Certificate will auto-renew via certbot container"