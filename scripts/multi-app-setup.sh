#!/bin/bash

# Multi-App Server Setup Script for Wedding Website
# Use this when you already have other applications running on your server

set -e

echo "🚀 Setting up Wedding Website alongside existing applications..."

# Check if nginx is already running
if systemctl is-active --quiet nginx; then
    echo "✅ Detected existing nginx installation"
    EXISTING_NGINX=true
else
    echo "❌ No existing nginx detected"
    EXISTING_NGINX=false
fi

# Check if port 80/443 are in use
if ss -tuln | grep -q ":80 "; then
    echo "⚠️  Port 80 is already in use"
    PORT_80_USED=true
else
    PORT_80_USED=false
fi

if ss -tuln | grep -q ":443 "; then
    echo "⚠️  Port 443 is already in use"
    PORT_443_USED=true
else
    PORT_443_USED=false
fi

# Update system (if needed)
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "🐳 Installing Docker..."
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt update
    sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    sudo usermod -aG docker $USER
fi

# Install Docker Compose if not present
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Create application directory
echo "📁 Setting up application directory..."
sudo mkdir -p /opt/hochzeit-website
sudo chown $USER:$USER /opt/hochzeit-website

# Clone repository
echo "📋 Cloning repository..."
cd /opt/hochzeit-website
if [ ! -d ".git" ]; then
    git clone https://github.com/tomkepia/hochzeit-website.git .
fi

# Create production environment file
echo "⚙️ Creating production environment file..."
cp .env.production.example .env.production

if [ "$EXISTING_NGINX" = true ]; then
    echo "🔧 Configuring for shared nginx setup..."
    
    # Create nginx configuration for existing nginx
    sudo mkdir -p /etc/nginx/sites-available
    sudo mkdir -p /etc/nginx/sites-enabled
    
    echo "📝 Creating nginx site configuration..."
    cat > /tmp/hochzeit-website << 'EOF'
# Wedding Website Configuration for Existing Nginx
server {
    listen 80;
    server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name DOMAIN_PLACEHOLDER www.DOMAIN_PLACEHOLDER;

    # SSL configuration (update paths as needed)
    ssl_certificate /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/DOMAIN_PLACEHOLDER/privkey.pem;
    
    # SSL security settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Strict-Transport-Security "max-age=31536000" always;

    # API routes to backend (running on localhost:8001)
    location /api {
        rewrite ^/api(.*)$ $1 break;
        
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout settings
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Frontend (running on localhost:3001)
    location / {
        proxy_pass http://127.0.0.1:3001;
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
            proxy_pass http://127.0.0.1:3001;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
}
EOF

    sudo mv /tmp/hochzeit-website /etc/nginx/sites-available/hochzeit-website
    
    echo "✅ Multi-app setup completed!"
    echo ""
    echo "🔧 Next steps (manual):"
    echo "1. Edit /opt/hochzeit-website/.env.production with your actual values"
    echo "2. Replace 'DOMAIN_PLACEHOLDER' in /etc/nginx/sites-available/hochzeit-website with your domain"
    echo "3. Enable the site: sudo ln -s /etc/nginx/sites-available/hochzeit-website /etc/nginx/sites-enabled/"
    echo "4. Test nginx config: sudo nginx -t"
    echo "5. Reload nginx: sudo systemctl reload nginx"
    echo "6. Start the wedding app: docker-compose -f docker-compose.prod-shared.yml up -d"
    echo "7. Set up SSL for your domain using your existing SSL management"
    
else
    echo "⚠️  No existing nginx detected. You can use the standard deployment method."
    echo "   Run: ./scripts/server-setup.sh instead"
fi

echo ""
echo "📝 Important Notes:"
echo "- Wedding app will run on ports 3001 (frontend), 8001 (backend), 5433 (database)"
echo "- These ports are bound to localhost only for security"
echo "- Your existing nginx will proxy requests to these ports"
echo "- Make sure your domain points to this server"
echo "- SSL certificates should be managed by your existing setup"