# $FATHOOD website with Meme Booth and Wall of Fat

## What's in here
- public/index.html: the website, including the Meme Booth and the Wall of Fat
- public/booth.js and public/booth/: the booth code and its pieces
- public/admin.html: your private page for approving memes (go to /admin.html)
- netlify/functions/: the small server programs that save, list and approve memes
- netlify.toml and package.json: settings Netlify reads automatically

## One-time setup (no coding needed)
1. Make a free GitHub account at github.com and create a new repository called fathood-site (Private is fine).
2. On the new repository page, click "uploading an existing file". Unzip fathood-site.zip, open the fathood-site folder,
   select everything inside it (netlify.toml, package.json, README.md, .gitignore and the public and netlify folders)
   and drag it all onto the page. Click "Commit changes".
3. In Netlify, open your site, go to Site configuration > Build & deploy > Continuous deployment and choose
   "Link repository". Pick GitHub and your fathood-site repository. Leave the build command empty. Netlify reads
   the rest from netlify.toml.
4. In Netlify, go to Site configuration > Environment variables and add ADMIN_PASSWORD with a strong password of
   at least 8 characters. This is the password for /admin.html. Do not share it.
5. Go to Deploys and click "Trigger deploy" > "Deploy site".

## Every update after that
Upload the changed files to the same GitHub repository (same "Add file > Upload files" button). Netlify
redeploys by itself within a minute.

## Approving memes
Open https://YOUR-SITE/admin.html, enter the password, then Approve or Delete. "On the wall" lets you take a meme
down again later.
