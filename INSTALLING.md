Installing locator-tool
=======================

```sh
$ mkdir -p www
$ cd www/

$ git clone https://github.com/simon04/locator-tool.git python
$ cd python/

$ virtualenv venv
$ source venv/bin/activate
$ cd src/
$ pip install -r requirements.txt

$ cp config-example.py config.py
# generate random string for SECRET_KEY
# for OAUTH_CONSUMER_KEY and OAUTH_CONSUMER_SECRET see below

$ cd static/
$ yarn
$ yarn build

# specific to tools.wmflabs.org, see https://github.com/wikimedia/operations-software-tools-webservice/blob/master/toollabs/webservice/services/pythonwebservice.py
$ webservice2 uwsgi-python start
```

## Register OAuth client

Register tool at https://meta.wikimedia.org/wiki/Special:OAuthConsumerRegistration/propose with "OAuth callback URL" = https://tools.wmflabs.org/locator-tool/oauth-callback and "Edit existing pages" grant. Insert the displayed strings as `OAUTH_CONSUMER_KEY` and `OAUTH_CONSUMER_SECRET` into the `config.ini` file.

## Further information

For more details, see:

* https://wikitech.wikimedia.org/wiki/Help:Tool_Labs/Python_application_stub
* https://www.mediawiki.org/wiki/Extension:OAuth
* https://www.github.com/valhallasw/flask-mwoauth
