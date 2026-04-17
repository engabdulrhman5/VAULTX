from flask import Flask
from threading import Thread

app = Flask(__name__)


@app.route("/")
def home():
    return "I am alive"


def _run():
    app.run(host="0.0.0.0", port=8080)


def keep_alive():
    thread = Thread(target=_run, daemon=True)
    thread.start()

