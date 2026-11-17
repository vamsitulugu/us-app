us-app — weak-network changes
Option A (easiest): copy everything inside the "files" folder into your us-app folder, same paths, replace when asked.
Option B: in your us-app folder run:  git apply us-app.patch
Then commit and push. Vercel/Render redeploy by themselves.
After deploy: GitHub repo -> Actions tab -> "keep-alive" -> Enable / Run workflow once.
