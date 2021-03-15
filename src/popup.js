const REGEX = /^https?:\/\/(.+?)\.webex\.com\/(?:recordingservice|webappng)\/sites\/(.+?)\/.*([a-f0-9]{32})/g;

function copyLink() {
    let text = document.getElementById("content");
    text.disabled = false;
    text.select();
    document.execCommand("copy");
    text.blur();
    text.disabled = true;
}

function downloadChat() {
    let download = document.getElementById("download");
    let link = document.createElement("a");
    let title = document.getElementById("content").dataset.title;
    //reparsing + reparsing date
    let chatData = JSON.parse(download.dataset.content);
    if (document.getElementById("chat-opt").checked) {
        link.download = `${title}_chat.txt`;
        let out = [];
        for (let i = 0; i < chatData.length; i++) {
            let m = chatData[i];
            out.push(`${timeFormatter(m.timecode)} - ${m.name}\n${m.message}`);
        }
        let file = out.join("\n\n") + "\n";
        link.href = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(file)}`;
    } else if (document.getElementById("json-opt").checked) {
        link.download = `${title}_chat.json`;
        link.href = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(download.dataset.content)}`;
    } else if (document.getElementById("srt-opt").checked) {
        link.download = `${title}_chat.srt`;
        let file = "";
        for (let i = 0; i < chatData.length; i++) {
            file += constructSub(chatData[i], i+1);
        }
        link.href = `data:application/octet-stream;charset=utf-8,${encodeURIComponent(file)}`;
    }

    link.click();
    if (navigator.userAgent.indexOf("Safari") > -1) {
        chrome.runtime.sendMessage({ safariOpenUrl: link.href })
    }
}

function renderSuccess(title, url, chat) {
    document.getElementById("loading").style.display = "none";
    document.getElementById("success").style.display = "block";
    document.getElementById("content").innerText = url;
    document.getElementById("content").dataset.content = url;
    document.getElementById("content").dataset.title = title;
    document.getElementById("copy").onclick = copyLink;
    if (chat.length > 0) {
        document.getElementById("chat").style.display = "block";
        document.getElementById("download").dataset.content = JSON.stringify(chat);
        document.getElementById("download").onclick = downloadChat;
    }
}

function renderFailure() {
    document.getElementById("loading").style.display = "none";
    document.getElementById("errpage").style.display = "block";
}

function renderException(exception) {
    document.body.classList.add("fail");
    document.getElementById("loading").style.display = "none";
    document.getElementById("fail").style.display = "block";
}

function checkUpdates() {
    fetch("https://api.github.com/repos/jacopo-j/webxdownloader/releases/latest")
        .then(response => response.json())
        .then(data => {
            let latestVersion = data.tag_name;
            let currentVersion = chrome.runtime.getManifest().version;
            if (latestVersion && latestVersion != currentVersion) {
                document.getElementById("updates-available").style.display = "block";
                if (navigator.userAgent.indexOf("Safari") > -1) {
                    document.getElementById("updates-link").addEventListener("click", (event) => {
                        chrome.runtime.sendMessage({
                            safariOpenUrl: document.getElementById("updates-link").getAttribute("href")
                        });
                    });
                }
            }
        })
}

function timeFormatter(date, asTimespan = false) {
    var date = new Date(date);
    var h;
    if (asTimespan) {
        h = date.getUTCHours();
    } else {
        h = date.getHours();
    }
    let hour = ("0" + h).slice(-2);
    let minute = ("0" + date.getMinutes()).slice(-2);
    let second = ("0" + date.getSeconds()).slice(-2);
    return `${hour}:${minute}:${second}`;
}

function constructSub(message, index) {
    var duration = 1.5 + 2 * message.message.split(' ').length;
    var at = message.timecode - this.startTime;
    text = index + '\n' +
        timeFormatter(at, true) + ',000 --> ' + timeFormatter(at + duration * 1000, true) + ',000' + '\n' +
        message.name + ': ' + message.message + '\n' +
        '\n';
    return text;
}

function callback(tabs) {
    checkUpdates();
    var url = tabs[0].url;
    let match = REGEX.exec(url);
    if (!match) {
        renderFailure();
        return;
    }
    chrome.tabs.sendMessage(tabs[0].id, {
        apiResponse: true
    }, (data) => {
        if (chrome.runtime.lastError) {
            console.log(chrome.runtime.lastError);
            renderFailure();
            return;
        }
        if (data == -1) {
            renderFailure();
            return;
        } else if (!data) {
            renderException(null);
            return;
        }
        try {
            let host = data["mp4StreamOption"]["host"];
            let recording_dir = data["mp4StreamOption"]["recordingDir"];
            let timestamp = data["mp4StreamOption"]["timestamp"];
            let token = data["mp4StreamOption"]["token"];
            let xml_name = data["mp4StreamOption"]["xmlName"];
            let playback_option = data["mp4StreamOption"]["playbackOption"];
            let meeting_name = data["recordName"];
            fetch(`${host}/apis/html5-pipeline.do?recordingDir=${recording_dir}&timestamp=${timestamp}&token=${token}&xmlName=${xml_name}&isMobileOrTablet=false&ext=${playback_option}`)
                .then(response => response.text())
                .then(text => (new window.DOMParser()).parseFromString(text, "text/xml"))
                .then(data => {
                    let filename = data.getElementsByTagName("Sequence")[0].textContent;
                    let messages = data.getElementsByTagName("Message");
                    this.startTime = parseInt(data.getElementsByTagName("StartTimeUTC")[0].textContent);
                    let chat = [];
                    for (let i = 0; i < messages.length; i++) {
                        try {
                            chat.push({
                                "timecode": parseInt((messages[i].getElementsByTagName("DateTimeUTC")[0].textContent)),
                                "name": messages[i].getElementsByTagName("LoginName")[0].textContent,
                                "message": messages[i].getElementsByTagName("Content")[0].textContent
                            });
                        } catch (exception) {
                            continue;
                        }
                    }
                    let hlsUrl = `${host}/hls-vod/recordingDir/${recording_dir}/timestamp/${timestamp}/token/${token}/fileName/${filename}.m3u8`;
                    renderSuccess(meeting_name, hlsUrl, chat);
                })
                .catch(exception => {
                    renderException(exception);
                });
        } catch (exception) {
            renderException(exception);
        }
    });
}

var query = { active: true, currentWindow: true };
chrome.tabs.query(query, callback);
