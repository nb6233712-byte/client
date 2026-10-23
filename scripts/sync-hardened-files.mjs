import fs from 'node:fs';
import path from 'node:path';

const rootDir = 'c:/Users/user/Desktop/web app1';
const webAppDir = path.join(rootDir, 'web app');

const syncMap = [
  {
    src: path.join(webAppDir, 'js/firebase.js'),
    destinations: [
      path.join(webAppDir, 'firebase.js'),
      path.join(webAppDir, 'client/firebase.js'),
      path.join(webAppDir, 'client/js/firebase.js'),
      path.join(webAppDir, 'firm/client/firebase.js'),
      path.join(webAppDir, 'firm/client/js/firebase.js'),
      path.join(webAppDir, 'firm/js/firebase.js'),
      path.join(rootDir, 'client/firebase.js'),
      path.join(rootDir, 'client/js/firebase.js'),
      path.join(rootDir, 'firm/client/firebase.js'),
      path.join(rootDir, 'firm/client/js/firebase.js'),
      path.join(rootDir, 'firm/js/firebase.js')
    ]
  },
  {
    src: path.join(webAppDir, 'js/auth-guard.js'),
    destinations: [
      path.join(webAppDir, 'client/js/auth-guard.js'),
      path.join(webAppDir, 'firm/js/auth-guard.js'),
      path.join(rootDir, 'client/js/auth-guard.js'),
      path.join(rootDir, 'firm/js/auth-guard.js'),
      path.join(rootDir, 'firm/client/js/auth-guard.js')
    ]
  },
  {
    src: path.join(webAppDir, 'js/core/layout.js'),
    destinations: [
      path.join(webAppDir, 'client/js/core/layout.js'),
      path.join(webAppDir, 'firm/js/core/layout.js'),
      path.join(rootDir, 'client/js/core/layout.js'),
      path.join(rootDir, 'firm/js/core/layout.js'),
      path.join(rootDir, 'firm/client/js/core/layout.js'),
      path.join(rootDir, 'js/core/layout.js')
    ]
  },
  {
    src: path.join(webAppDir, 'js/firm/clients.js'),
    destinations: [
      path.join(webAppDir, 'client/js/firm/clients.js'),
      path.join(webAppDir, 'firm/js/firm/clients.js'),
      path.join(rootDir, 'client/js/firm/clients.js'),
      path.join(rootDir, 'firm/js/firm/clients.js'),
      path.join(rootDir, 'firm/client/js/firm/clients.js')
    ]
  },
  {
    src: path.join(webAppDir, 'js/firm/documents.js'),
    destinations: [
      path.join(webAppDir, 'client/js/firm/documents.js'),
      path.join(webAppDir, 'firm/js/firm/documents.js'),
      path.join(rootDir, 'client/js/firm/documents.js'),
      path.join(rootDir, 'firm/js/firm/documents.js'),
      path.join(rootDir, 'firm/client/js/firm/documents.js')
    ]
  },
  {
    src: path.join(webAppDir, 'signatures.html'),
    destinations: [
      path.join(webAppDir, 'firm/signatures.html'),
      path.join(rootDir, 'firm/signatures.html')
    ]
  },
  {
    src: path.join(webAppDir, 'firestore.rules'),
    destinations: [
      path.join(webAppDir, 'client/firestore.rules'),
      path.join(rootDir, 'client/firestore.rules'),
      path.join(rootDir, 'firm/firestore.rules'),
      path.join(rootDir, 'firm/client/firestore.rules')
    ]
  },
  {
    src: path.join(webAppDir, 'js/client/dashboard.js'),
    destinations: [
      path.join(webAppDir, 'client/js/client/dashboard.js'),
      path.join(webAppDir, 'firm/js/client/dashboard.js'),
      path.join(webAppDir, 'firm/client/js/client/dashboard.js'),
      path.join(rootDir, 'js/client/dashboard.js'),
      path.join(rootDir, 'client/js/client/dashboard.js'),
      path.join(rootDir, 'firm/js/client/dashboard.js'),
      path.join(rootDir, 'firm/client/js/client/dashboard.js')
    ]
  },
  {
    src: path.join(webAppDir, 'js/firm/dashboard.js'),
    destinations: [
      path.join(rootDir, 'firm/js/firm/dashboard.js')
    ]
  },
  {
    src: path.join(webAppDir, 'firm/dashboard.html'),
    destinations: [
      path.join(rootDir, 'firm/dashboard.html')
    ]
  },
  {
    src: path.join(webAppDir, 'firm/documents.html'),
    destinations: [
      path.join(rootDir, 'firm/documents.html')
    ]
  },
  {
    src: path.join(webAppDir, 'firm/messages.html'),
    destinations: [
      path.join(rootDir, 'firm/messages.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/messages.html'),
    destinations: [
      path.join(rootDir, 'client/messages.html'),
      path.join(rootDir, 'firm/client/messages.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/login.html'),
    destinations: [
      path.join(rootDir, 'client/login.html')
    ]
  },
  {
    src: path.join(webAppDir, 'js/client/documents.js'),
    destinations: [
      path.join(webAppDir, 'client/js/client/documents.js'),
      path.join(webAppDir, 'firm/js/client/documents.js'),
      path.join(rootDir, 'client/js/client/documents.js'),
      path.join(rootDir, 'firm/client/js/client/documents.js'),
      path.join(rootDir, 'firm/js/client/documents.js'),
      path.join(rootDir, 'js/client/documents.js')
    ]
  },
  {
    src: path.join(webAppDir, 'client/documents.html'),
    destinations: [
      path.join(rootDir, 'client/documents.html'),
      path.join(rootDir, 'firm/client/documents.html')
    ]
  },
  {
    src: path.join(webAppDir, 'firm/login.html'),
    destinations: [
      path.join(rootDir, 'firm/login.html')
    ]
  },
  {
    src: path.join(webAppDir, 'storage.rules'),
    destinations: [
      path.join(webAppDir, 'client/storage.rules'),
      path.join(rootDir, 'client/storage.rules'),
      path.join(rootDir, 'firm/storage.rules')
    ]
  },
  {
    src: path.join(webAppDir, 'js/client/document-delivery-client.js'),
    destinations: [
      path.join(webAppDir, 'client/js/client/document-delivery-client.js'),
      path.join(webAppDir, 'firm/js/client/document-delivery-client.js'),
      path.join(rootDir, 'client/js/client/document-delivery-client.js'),
      path.join(rootDir, 'firm/js/client/document-delivery-client.js'),
      path.join(rootDir, 'firm/client/js/client/document-delivery-client.js'),
      path.join(rootDir, 'js/client/document-delivery-client.js')
    ]
  },
  {
    src: path.join(webAppDir, 'css/app.css'),
    destinations: [
      path.join(rootDir, 'css/app.css'),
      path.join(rootDir, 'client/css/app.css'),
      path.join(rootDir, 'firm/css/app.css'),
      path.join(rootDir, 'firm/client/css/app.css'),
      path.join(webAppDir, 'client/css/app.css'),
      path.join(webAppDir, 'firm/css/app.css')
    ]
  },
  {
    src: path.join(webAppDir, 'css/shared-layout.css'),
    destinations: [
      path.join(rootDir, 'css/shared-layout.css'),
      path.join(rootDir, 'client/css/shared-layout.css'),
      path.join(rootDir, 'firm/css/shared-layout.css'),
      path.join(rootDir, 'firm/client/css/shared-layout.css'),
      path.join(webAppDir, 'client/css/shared-layout.css'),
      path.join(webAppDir, 'firm/css/shared-layout.css')
    ]
  },
  {
    src: path.join(webAppDir, 'js/firm/delivery-queue.js'),
    destinations: [
      path.join(rootDir, 'firm/js/firm/delivery-queue.js')
    ]
  },
  {
    src: path.join(webAppDir, 'client/profile.html'),
    destinations: [
      path.join(rootDir, 'client/profile.html'),
      path.join(rootDir, 'firm/client/profile.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/dashboard.html'),
    destinations: [
      path.join(rootDir, 'client/dashboard.html'),
      path.join(rootDir, 'firm/client/dashboard.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/updates.html'),
    destinations: [
      path.join(rootDir, 'client/updates.html'),
      path.join(rootDir, 'firm/client/updates.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/signatures.html'),
    destinations: [
      path.join(rootDir, 'client/signatures.html'),
      path.join(rootDir, 'firm/client/signatures.html')
    ]
  },
  {
    src: path.join(webAppDir, 'js/client/signatures.js'),
    destinations: [
      path.join(webAppDir, 'client/js/client/signatures.js'),
      path.join(webAppDir, 'firm/js/client/signatures.js'),
      path.join(rootDir, 'client/js/client/signatures.js'),
      path.join(rootDir, 'firm/js/client/signatures.js'),
      path.join(rootDir, 'firm/client/js/client/signatures.js')
    ]
  },
  {
    src: path.join(webAppDir, 'client/tax-return.html'),
    destinations: [
      path.join(rootDir, 'client/tax-return.html'),
      path.join(rootDir, 'firm/client/tax-return.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/services.html'),
    destinations: [
      path.join(rootDir, 'client/services.html'),
      path.join(rootDir, 'firm/client/services.html')
    ]
  },
  {
    src: path.join(webAppDir, 'client/billing.html'),
    destinations: [
      path.join(rootDir, 'client/billing.html'),
      path.join(rootDir, 'firm/client/billing.html')
    ]
  }
];

let syncedCount = 0;
for (const item of syncMap) {
  if (!fs.existsSync(item.src)) {
    console.warn(`Source not found: ${item.src}`);
    continue;
  }
  const content = fs.readFileSync(item.src, 'utf8');
  for (const dest of item.destinations) {
    if (fs.existsSync(dest)) {
      let destContent = content;
      if (dest.endsWith('.html') && (dest.startsWith(path.join(rootDir, 'firm')) || dest.startsWith(path.join(rootDir, 'client')))) {
        destContent = destContent
          .replaceAll('href="../css/', 'href="css/')
          .replaceAll('src="../js/', 'src="js/');
      }
      fs.writeFileSync(dest, destContent, 'utf8');
      syncedCount++;
      console.log(`✓ Synced: ${path.basename(item.src)} -> ${dest}`);
    }
  }
}

console.log(`\nSuccessfully synchronized ${syncedCount} mirror files.`);
