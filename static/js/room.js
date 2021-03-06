(function ($) {

var ChatManager = {
    chatWindow : null,
    chatInput : null,
    _submitCallback : null,

    init : function (chatId, chatInputId, chatSubmitId) {
        this.chatWindow = document.getElementById(chatId);
        this.chatInput = document.getElementById(chatInputId);
        var self = this;
        $(chatSubmitId).click( function () {
            self.clickSubmit();
        });
    },

    displayMessage : function(user, timestamp, message) { 
        var display_message = user + ':' + message;
        this.chatWindow.innerHTML += '<p>'+display_message+'</p>';
        this.chatWindow.scrollTop = SocketManager.chat_window.scrollHeight;
    },

    onSubmit : function (callee) {
        _submitCallback = callee;
    },

    clickSubmit : function () {
        var content = $(this.chatInput).val();
        if (_submitCallback != null) {
            _submitCallback(content);
        }
        $(this.chatInput).val("");
    }
}

var SocketManager = {
    socket : "",

    userId : null,

    chat_window : "",

    _messageCallbacks: {},

    onMessage : function(messageType, callee) {
        this._messageCallbacks[messageType] = callee;
    },

    open : function(socket_uri) {
        this.chat_window = document.getElementById('chat-window');
        this.socket = new WebSocket(socket_uri);
        var self = this;
        this.socket.onopen = function() { 
            console.log("Opened socket.  Sending auth info.");
            self.socket.send(JSON.stringify({
                'type': 'LOGIN',
            }));
        };
        this.socket.onmessage = function (evt) {
            self.handleMessage(evt);
        };
        this.socket.onclose = function() { console.log("Closed socket."); };
    },

    handleMessage : function(evt) {
        var data = JSON.parse(evt.data);
        console.log(data);

        if (this._messageCallbacks.hasOwnProperty(data.type)) {
            this._messageCallbacks[data.type](data);
        }
        else {
            console.log("No matching callback for " + data.type + "!");
        }
    },
}

var VideoManager = {
    element : null,
    _clickPlayCallback: null,
    _clickPauseCallback: null,

    init : function(videoElId, playId, pauseId) {
        this.element = document.getElementById(videoElId);
        var self = this;
        $(playId).click(function() {self.clickPlay();});
        $(pauseId).click(function() {self.clickPause();});
    },

    play : function() {
        this.element.playbackRate = 1;
        this.element.play();
    },

    isPlaying : function () {
        return !this.element.paused;
    },

    onClickPlay : function(callee) {
        this._clickPlayCallback = callee;
    },

    clickPlay : function () {
        if (this._clickPlayCallback !== null) {
            this._clickPlayCallback();
        }
    },

    pause : function() {
        this.element.pause();
    },

    onClickPause : function (callee) {
        this._clickPauseCallback = callee;
    },

    clickPause : function() {
        if (this._clickPauseCallback) {
            this._clickPauseCallback();
        }
    },

    generateTimestamp : function () {
        var currentTime = this.element.currentTime;
        return {
            'type': 'TIMESTAMP',
            'time': currentTime
        }
    },

    handleTimestamp : function (data, ourPing) {
        if (!this.isPlaying()) {
            this.play();
        }
        console.log(data);
        //calcuate approximate host timestamp
        var hostTimestamp = data.data.time + (data.data.ping / 1000) + (ourPing / 1000);
        console.log(hostTimestamp);
        //if diff is greater than 100 ms, speed up or slow down by 10%
        var diff = hostTimestamp - this.element.currentTime;
        console.log(diff)

        if (diff > .20) {
            //speed up
            console.log('speeding up');
            this.element.playbackRate = 1.05;
        }
        else if (diff < -.20) {
            //slow down
            console.log('slowing down');
            this.element.playbackRate = 0.95
        }
        else {
            this.element.playbackRate = 1;
        }
    },

    source : function (source_url) {
        if (source_url === undefined) {
            return $(this.element)
                .find('source')
                .attr('src');
        }

        this.element.pause();
        this.element.currentTime = 0;
        $(this.element)
            .find('source')
            .attr('src', source_url);
        this.element.load();
        this.element.addEventListener('loadeddata', function() {
            SocketManager.socket.send(JSON.stringify({
                'type': 'CHAT',
                'message': 'Loaded video file'
            }));
        });
        return this.element;
    }
}

var TimeManager = {
    _currentPing: null,
    _lastFivePings: null,
    _currentPingRequests: null, //for monitoring separate ping requests. ideally, only one is active at a time, but networking being what it is can break that assumption pretty easily
    _pingIncrement : null,
    element : null,
    continuePing : null,

    init : function (pingHudId) {
        this.element = document.getElementById(pingHudId);
        this._currentPing = 0;
        this._lastFivePings = [];
        this._currentPingRequests = {};
        this._pingIncrement = 1;
        this.continuePing = true;
    },

    handlePong : function (data) {
        //match to a ping
        var pingId = data.data.id;
        if (! this._currentPingRequests.hasOwnProperty(pingId)) { //if the id doesn't exist, throw away pong
            return;
        }

        //calculate time diff
        var lastTime = this._currentPingRequests[pingId];
        var currentTime = new Date().getTime();
        var diff = currentTime - lastTime; //assuming lastTime never > than currentTime
        diff /= 2; //we only want 1 way, not round trip

        //insert into ping queue
        this.insertPingTime(diff);

        this._currentPing = diff;

        this.render();
    },

    generatePing : function () {
        var id = this._pingIncrement;
        var newPing = {
            type : 'PING',
            id : id
        };

        this._currentPingRequests[id] = new Date().getTime();

        this._pingIncrement++; 

        return newPing;
    },

    insertPingTime : function (time) {
        if (this._lastFivePings.length == 5) {
            this._lastFivePings.shift(); //kicks out head element
        }

        this._lastFivePings.push(time);
    },

    averagePing : function () {
        //actually reports median, since we get weird pings from time to time
        var index = Math.floor(this._lastFivePings.length/2);
        var clone = this._lastFivePings.slice(0); // we do not actually want to sort _lastFivePings as it's being used as a queue
        clone.sort(function(a, b) { return a-b;});

        return clone[index];
    },

    enablePing : function () {
        this.continuePing = true;
    },

    disablePing : function () {
        this.continuePing = false;
    },

    render : function () {
        this.element.innerHTML = "Current Ping: " + this._currentPing + " <br /> Average Ping: " + this.averagePing();
    }
}

var init = function(location) {
    //init modules
    VideoManager.init("video-player", "#video-play", "#video-pause"); //TODO fix the id diff madness
    ChatManager.init('chat-window', 'chatText', '#chatSubmit');
    TimeManager.init('ping-hud');

    //tie modules together
    SocketManager.onMessage('CHAT', function (data) {
        ChatManager.displayMessage(data.user, 'TIMESTAMP', data.data.message);
    });

    SocketManager.onMessage('PLAY', function () {
        VideoManager.play();
    });

    SocketManager.onMessage('PAUSE', function () {
        VideoManager.pause();
    });

    SocketManager.onMessage('SET_SOURCE', function (data) {
        VideoManager.source(data.data.message.source_url);
    });

    SocketManager.onMessage('PONG', function (data) {
        TimeManager.handlePong(data);
    });

    SocketManager.onMessage('LOGIN', function (data) {
        SocketManager.userId = data.data.user;
    });

    SocketManager.onMessage('TIMESTAMP', function(data) {
        var i = TimeManager.averagePing();
        console.log('calculating diff ' + i);
        // ignore if we originated the timestamp
        if (data.user == SocketManager.userId) {
            console.log('wait, this is our timestamp... ignoring.');
            return;
        }
        VideoManager.handleTimestamp(data, i);
    });

    SocketManager.onMessage('JOIN', function(data) {
        if (data.user == SocketManager.userId) {
            console.log('wait, we just joined... ignoring');
            return;
        }

        var currSource = VideoManager.source();
        if (currSource === '') {
            return;
        }

        var currVideoState = VideoManager.generateTimestamp();
        currVideoState['source'] = currSource;

        var syncData = {
            'type': 'JOINSYNC',
            'message': currVideoState
        };
        SocketManager.socket.send(
            JSON.stringify(syncData)
        );
    });

    SocketManager.onMessage('JOINSYNC', function(data) {
        if (VideoManager.source() != '') {
            console.log('already playing. ignoring.');
            return;
        }
         
        var source = data.data.message.source;

        if (source == undefined) {
            console.log('bad set. ignoring');
            return;
        }

        var time = data.data.message.time;

        if (time == undefined) {
            console.log('bad set. ignoring');
            return;
        }

        VideoManager.source(source).addEventListener('loadedmetadata', function() {
            this.currentTime = time;
            VideoManager.element.removeEventListener('loadedmetadata', arguments.callee);
        });
    });

    VideoManager.onClickPlay( function () { //server signals to client to actually play
        SocketManager.socket.send(JSON.stringify({
            'type': 'PLAY'
        }));
    });

    VideoManager.onClickPause( function () { //server signals to client to actually pause
        SocketManager.socket.send(JSON.stringify({
            'type': 'PAUSE'
        }));
    });

    ChatManager.onSubmit( function (chatContent) {
        SocketManager.socket.send(JSON.stringify({
            'type': 'CHAT',
            'message': chatContent
        }));
    });

    $("#source_url_form").on('submit', function() { //doesn't neatly fit anywhere at the moment
        var new_source = $('#source_url_input').val();
        SocketManager.socket.send(JSON.stringify({
            'type': 'SET_SOURCE',
            'message': {
                'source_url': new_source,
            },
        }));
        return false;
    });


    SocketManager.open(location);

    //set up and start pinging
    var ping = function () {
        if (TimeManager.continuePing) {
            SocketManager.socket.send(
                JSON.stringify(
                    TimeManager.generatePing()
                )
            );
        }
        setTimeout(ping, 2000);
    };

    setTimeout(ping, 2000);

    //set up and start reporting timestamp
    var reportTimestamp = function () {
        if (VideoManager.isPlaying()) {
            console.log("reporting timestamp");
            var timestamp = VideoManager.generateTimestamp();
            //add in average ping
            timestamp['ping'] = TimeManager.averagePing();
            SocketManager.socket.send(
                JSON.stringify(timestamp)
            );

        }
        setTimeout(reportTimestamp, 4333);
    };

    setTimeout(reportTimestamp, 4333);
}

$(document).ready(function () {
    var roomNum = window.location.pathname.split('/')[2];
    var location = "ws://" + window.location.host + "/room/" + roomNum + '/socket';
    init(location);
});

window.WatchWithMe = {
    'videoController': VideoManager,
    'socketController': SocketManager,
    'chatController': ChatManager,
    'timeController' : TimeManager,
    'init': init
}

})($);
