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
        console.log(evt.data);
        var data = JSON.parse(evt.data);

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
        this.element.play();
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

    source : function (source_url) {
        if (source_url === null) {
            return $(this.element)
                .find('source')
                .attr('src');
        }

        this.element.pause();
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
    }
}

var init = function(location) {
    //init modules
    VideoManager.init("video-player", "#video-play", "#video-pause"); //TODO fix the id diff madness
    ChatManager.init('chat-window', 'chatText', '#chatSubmit');

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
        console.log(VideoManager.element);
        VideoManager.source(data.data.message.source_url);
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
    'init': init
}

})($);
