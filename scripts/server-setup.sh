#!/bin/bash

# Hetzner VPS Initial Setup Script for Wedding Website
# Run this script on your fresh Hetzner Ubuntu server

set -e

echo "🚀 Starting Hetzner VPS setup for Wedding Website..."

# Update system
echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install essential packages
echo "🔧 Installing essential packages..."
sudo apt install -y \
    curl \
    wget \
    git \
    ufw \
    fail2ban \
    unattended-upgrades \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# Configure automatic security updates
echo "🔒 Configuring automatic security updates..."
sudo dpkg-reconfigure -plow unattended-upgrades

# Setup firewall
echo "🔥 Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add user to docker group
sudo usermod -aG docker $USER

# Install Docker Compose (standalone)
echo "📦 Installing Docker Compose..."
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Create application directory
echo "📁 Setting up application directory..."
sudo mkdir -p /opt/hochzeit-website
sudo chown $USER:$USER /opt/hochzeit-website

# Clone repository
echo "📋 Cloning repository..."
cd /opt/hochzeit-website
git clone https://github.com/tomkepia/hochzeit-website.git .

# Create necessary directories for SSL
echo "🔐 Creating SSL directories..."
mkdir -p certbot/conf certbot/www

# Create production environment file
echo "⚙️ Creating production environment file..."
cp .env.production.example .env.production

echo "✅ Basic setup completed!"
echo ""
echo "🔧 Next steps (manual):"
echo "1. Edit /opt/hochzeit-website/.env.production with your actual values"
echo "2. Replace 'yourdomain.com' in nginx configs with your actual domain"
echo "3. Run SSL setup script: ./scripts/setup-ssl.sh yourdomain.com your-email@example.com"
echo "4. Start the application: docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "📝 Important:"
echo "- Logout and login again for Docker group changes to take effect"
echo "- Make sure your domain's A record points to this server's IP"
echo "- Add GitHub secrets for CI/CD deployment"