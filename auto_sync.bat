@echo off
cd /d "C:\Projects\digital-personal-wiki"
git add .
git diff-index --quiet HEAD || (
    git commit -m "Auto update wiki"
    git push origin main
)