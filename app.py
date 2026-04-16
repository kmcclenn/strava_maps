import os
import json
import time
import secrets
import requests
from flask import Flask, redirect, request, session, jsonify, render_template

CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'config.json')

app = Flask(__name__)

STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize'
STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
STRAVA_API_BASE = 'https://www.strava.com/api/v3'

# ── Hosted mode: credentials come from environment variables (Render, etc.)
# ── Local mode:  credentials come from config.json (written by the /setup page)
HOSTED = bool(os.getenv('STRAVA_CLIENT_ID'))


def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}


def save_config(data):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def get_credentials():
    if HOSTED:
        return os.getenv('STRAVA_CLIENT_ID'), os.getenv('STRAVA_CLIENT_SECRET')
    cfg = load_config()
    return cfg.get('client_id'), cfg.get('client_secret')


def get_redirect_uri():
    # APP_URL must be set on Render to the public URL, e.g. https://my-app.onrender.com
    base = os.getenv('APP_URL', 'http://localhost:5000').rstrip('/')
    return base + '/callback'


# ── Secret key: env var in hosted mode, stable value in config.json locally
if HOSTED:
    app.secret_key = os.getenv('SECRET_KEY', secrets.token_hex(32))
else:
    _cfg = load_config()
    if 'secret_key' not in _cfg:
        _cfg['secret_key'] = secrets.token_hex(32)
        save_config(_cfg)
    app.secret_key = _cfg['secret_key']


def ensure_valid_token():
    if 'access_token' not in session:
        return False
    if session.get('expires_at', 0) <= time.time():
        client_id, client_secret = get_credentials()
        resp = requests.post(STRAVA_TOKEN_URL, data={
            'client_id': client_id,
            'client_secret': client_secret,
            'refresh_token': session.get('refresh_token'),
            'grant_type': 'refresh_token',
        })
        if resp.ok:
            data = resp.json()
            session['access_token'] = data['access_token']
            session['refresh_token'] = data['refresh_token']
            session['expires_at'] = data['expires_at']
        else:
            return False
    return True


# ── Routes ──────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    if not HOSTED:
        client_id, client_secret = get_credentials()
        if not client_id or not client_secret:
            return redirect('/setup')
    return render_template('index.html', authenticated='access_token' in session)


# Local-only: setup page to enter credentials via the browser
@app.route('/setup', methods=['GET', 'POST'])
def setup():
    if HOSTED:
        return redirect('/')
    error = None
    if request.method == 'POST':
        client_id = request.form.get('client_id', '').strip()
        client_secret = request.form.get('client_secret', '').strip()
        if not client_id or not client_secret:
            error = 'Both fields are required.'
        else:
            cfg = load_config()
            cfg['client_id'] = client_id
            cfg['client_secret'] = client_secret
            save_config(cfg)
            return redirect('/auth')
    return render_template('setup.html', error=error)


@app.route('/reset-credentials')
def reset_credentials():
    if HOSTED:
        return redirect('/')
    cfg = load_config()
    cfg.pop('client_id', None)
    cfg.pop('client_secret', None)
    save_config(cfg)
    session.clear()
    return redirect('/setup')


@app.route('/auth')
def auth():
    client_id, _ = get_credentials()
    if not client_id:
        return redirect('/setup')
    params = {
        'client_id': client_id,
        'redirect_uri': get_redirect_uri(),
        'response_type': 'code',
        'scope': 'activity:read_all',
        'approval_prompt': 'auto',
    }
    url = STRAVA_AUTH_URL + '?' + '&'.join(f'{k}={v}' for k, v in params.items())
    return redirect(url)


@app.route('/callback')
def callback():
    error = request.args.get('error')
    code = request.args.get('code')
    if error or not code:
        return redirect('/?error=access_denied')

    client_id, client_secret = get_credentials()
    resp = requests.post(STRAVA_TOKEN_URL, data={
        'client_id': client_id,
        'client_secret': client_secret,
        'code': code,
        'grant_type': 'authorization_code',
    })
    if not resp.ok:
        return redirect('/?error=token_exchange_failed')

    data = resp.json()
    session['access_token'] = data['access_token']
    session['refresh_token'] = data['refresh_token']
    session['expires_at'] = data['expires_at']
    session['athlete'] = data.get('athlete', {})
    return redirect('/')


@app.route('/logout')
def logout():
    session.clear()
    return redirect('/')


@app.route('/api/athlete')
def api_athlete():
    if not ensure_valid_token():
        return jsonify({'error': 'Not authenticated'}), 401
    return jsonify(session.get('athlete', {}))


@app.route('/api/activities')
def api_activities():
    if not ensure_valid_token():
        return jsonify({'error': 'Not authenticated'}), 401

    headers = {'Authorization': f'Bearer {session["access_token"]}'}
    activities = []
    page = 1

    while True:
        resp = requests.get(
            f'{STRAVA_API_BASE}/athlete/activities',
            headers=headers,
            params={'page': page, 'per_page': 200},
            timeout=30,
        )
        if not resp.ok:
            break
        batch = resp.json()
        if not batch:
            break

        for a in batch:
            activities.append({
                'id': a['id'],
                'name': a['name'],
                'type': a.get('sport_type') or a.get('type') or 'Unknown',
                'date': a.get('start_date_local', ''),
                'distance': round(a.get('distance', 0)),
                'moving_time': a.get('moving_time', 0),
                'elapsed_time': a.get('elapsed_time', 0),
                'elevation_gain': round(a.get('total_elevation_gain', 0)),
                'avg_speed': round(a.get('average_speed', 0), 2),
                'max_speed': round(a.get('max_speed', 0), 2),
                'avg_hr': a.get('average_heartrate'),
                'max_hr': a.get('max_heartrate'),
                'kudos': a.get('kudos_count', 0),
                'polyline': a.get('map', {}).get('summary_polyline') or '',
                'start_latlng': a.get('start_latlng') or [],
            })

        page += 1

    return jsonify({'activities': activities, 'athlete': session.get('athlete', {})})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
