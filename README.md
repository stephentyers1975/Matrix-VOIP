# Matrix-VOIP
Matrix Freeswitch code: A Matrix &lt;--> Verto bridge, designed for 1:1 calls.

## Usage

### Installing

Set up and run a FreeSWITCH 1.6 or later (ideally 1.7).  Make sure `mod_verto` is installed and works with the verto example app (try to join a conference on 3500), then into the cloned repo directory:

```
$ npm install
```

### Registering
```
$ node app -r -u "http://appservice-url-here"
Generating registration to 'config/verto-single-registration.yaml' for the AS accessible from: http://appservice-url-here
```
Add `verto-single-registration.yaml` to Synapse's `homeserver.yaml` config file:
```
# homeserver.yaml
app_service_config_files: ["/path/to/repo/config/verto-single-registration.yaml"]
```

### Configuring
```
$ cp config/config.sample.yaml config/config.yaml
```

```yaml
# config/config.yaml
homeserver:
  url: http://localhost:8008
  domain: localhost

verto:
  url: "ws://freeswitch.example.org:8082/"
  passwd: "1234567890"

verto-dialog-params:
  login: "1004"
  ...
```

### Running
```
$ node app -c config/config.yaml
Loading config file /home/max/code/kreios/Matrix-VOIP/config/config.yaml
[wss://freeswitch.example.org:8082]: OPENED
[wss://freeswitch.example.org:8082]: SENDING {"jsonrpc":"2.0","method":"login","params":{"login":"<LOGIN HERE>","passwd":"<PASS HERE>","sessid":"f2e4449a-c3b2-4405-bd9e-17c2c7c3d9b2"},"id":1}

[wss://freeswitch.example.org:8082]: MESSAGE {"jsonrpc":"2.0","id":1,"result":{"message":"logged in","sessid":"f2e4449a-c3b2-4405-bd9e-17c2c7c3d9b2"}}

Running bridge on port 8191
```

You can supply `-p PORT` to set a custom port.

