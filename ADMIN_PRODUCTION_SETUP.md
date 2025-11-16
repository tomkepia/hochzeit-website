# 🔧 Production Admin Setup Instructions

## Files Changed for Production Compatibility:

### ✅ **Already Fixed in Code:**
1. **nginx-frontend.conf** - Removed API proxy (production nginx handles this)
2. **AdminPasswordGate.js** - Now uses environment variable for password
3. **nginx/conf.d/default.conf** - Added admin endpoint security
4. **`.env.production.example`** - Added admin password variable

## 🚀 **Required Actions on Your Hetzner Server:**

### **Step 1: Update Environment Variables**

SSH into your server and update your production environment file:

```bash
ssh root@your-server-ip
cd /opt/hochzeit-website
nano .env.production
```

Add this line to your `.env.production` file:
```env
REACT_APP_ADMIN_PASSWORD=your-secure-admin-password-here
```

**Example complete `.env.production`:**
```env
POSTGRES_DB=hochzeit_production
POSTGRES_USER=postgres
POSTGRES_PASSWORD=YOUR_SECURE_DB_PASSWORD_HERE
DATABASE_URL=postgresql://postgres:YOUR_SECURE_DB_PASSWORD_HERE@db:5432/hochzeit_production
ENVIRONMENT=production
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
REACT_APP_API_URL=https://yourdomain.com/api
REACT_APP_ADMIN_PASSWORD=your-secure-admin-password-here
SSL_EMAIL=your-email@example.com
DOMAIN=yourdomain.com
```

### **Step 2: Deploy Updated Code**

The changes are now in your codebase. Deploy them:

**Option A - If using GitHub Actions:**
```bash
# From your local machine
git add .
git commit -m "Add production admin functionality"
git push origin main
```

**Option B - Manual deployment on server:**
```bash
# On your server
cd /opt/hochzeit-website
git pull origin main
docker-compose -f docker-compose.prod-shared.yml down
docker-compose -f docker-compose.prod-shared.yml up --build -d
```

### **Step 3: Verify Admin Access**

After deployment, test the admin functionality:

1. **Main site**: `https://yourdomain.com/` (password: `t&j`)
2. **Admin panel**: `https://yourdomain.com/admin` (password: what you set in `REACT_APP_ADMIN_PASSWORD`)

## 🔍 **Testing Commands:**

```bash
# Check containers are running
docker-compose -f docker-compose.prod-shared.yml ps

# Test admin API endpoint
curl https://yourdomain.com/api/admin/guests

# View logs if needed
docker-compose -f docker-compose.prod-shared.yml logs frontend
docker-compose -f docker-compose.prod-shared.yml logs backend
docker-compose -f docker-compose.prod-shared.yml logs nginx
```

## 🛡️ **Security Features Added:**

- ✅ **Environment-based admin password** (no hardcoded secrets)
- ✅ **Strict rate limiting** for admin endpoints (3 requests/second max)
- ✅ **Additional security headers** for admin routes
- ✅ **Separate admin session management** (60-minute timeout)
- ✅ **No discoverable admin links** from main site

## 📋 **Verification Checklist:**

- [ ] Environment variable `REACT_APP_ADMIN_PASSWORD` is set
- [ ] Code is deployed with latest changes
- [ ] Containers are running properly
- [ ] Main website works: `https://yourdomain.com/`
- [ ] Admin panel works: `https://yourdomain.com/admin`
- [ ] Admin can see guest data
- [ ] SSL certificate is valid

## 🚨 **Important Notes:**

1. **Choose a strong admin password** - this protects your guest data
2. **The admin URL is hidden** - only accessible by direct navigation to `/admin`
3. **Admin sessions expire** after 60 minutes of inactivity
4. **Rate limiting protects** against brute force attempts

## 📞 **If Something Doesn't Work:**

1. Check environment variables: `cat .env.production`
2. Check container logs: `docker-compose -f docker-compose.prod-shared.yml logs`
3. Verify nginx config was updated properly
4. Test API endpoint directly: `curl https://yourdomain.com/api/health`