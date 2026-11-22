"""Wait for GitHub's artifact listing before the Pages deployment reads it."""
import json
import os
import time
from urllib.request import Request, urlopen

endpoint = (f"{os.environ['GITHUB_API_URL']}/repos/"
            f"{os.environ['GITHUB_REPOSITORY']}/actions/runs/"
            f"{os.environ['GITHUB_RUN_ID']}/artifacts?per_page=100")
request = Request(endpoint, headers={
    'Authorization': f"Bearer {os.environ['GH_TOKEN']}",
    'Accept': 'application/vnd.github+json',
})
name = os.environ['PAGES_ARTIFACT_NAME']
for attempt in range(18):
    with urlopen(request, timeout=20) as response:
        artifacts = json.load(response)['artifacts']
    matches = [item for item in artifacts if item['name'] == name and not item['expired']]
    if len(matches) == 1:
        print(f'Pages artifact ready: {name}', flush=True)
        break
    if len(matches) > 1:
        raise RuntimeError(f'Multiple artifacts found for {name}')
    print('Waiting for uploaded Pages artifact metadata...', flush=True)
    time.sleep(5)
else:
    raise RuntimeError(f'Uploaded Pages artifact not discoverable: {name}')
