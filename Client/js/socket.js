const { io } = require("socket.io-client");
const mediasoupClient = require('mediasoup-client')

const socket = io("http://localhost:3000/mediasoup");

socket.on("connect", () => {
    console.log("socket connect success");
}); 

let device
let rtpCapabilities
let producerTransport
let consumerTransport
let producer
let consumer

let params = {
    encodings: [
        {
            rid: 'r0',
            maxBitrate: 100000,
            scalabilityMode: 'S1T3',
        },
        {
            rid: 'r1',
            maxBitrate: 300000,
            scalabilityMode: 'S1T3',
        },
        {
            rid: 'r2',
            maxBitrate: 900000,
            scalabilityMode: 'S1T3',
        },
    ],
    codecOptions: {
        videoGoogleStartBitrate: 1000
    }
}

const streamSuccess = async (stream) => {
    document.querySelector(".localstream").srcObject = stream
    console.log(stream)
    const track = stream.getVideoTracks()[0]
    params = {
        track,
        ...params
      }
}

const getLocalStream = () => {
    navigator.mediaDevices.getDisplayMedia().then(
        streamSuccess
    ).catch(error => {
        console.log(error.message)
    })
}

const createDevice = async () => {
    try {
        device = new mediasoupClient.Device()

        await device.load({
            routerRtpCapabilities: rtpCapabilities
        })

        console.log('RTP Capabilities', device.rtpCapabilities)
    } catch (error) {
        console.log(error)
    }
}

const getRtpCapabilities = () => {
    socket.emit("getRtpCapabilities", (data) => {
        console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)

        rtpCapabilities = data.rtpCapabilities
    })
}

const createSendTransport = () => {
    socket.emit('createWebRTCTransport',{ sender:true },({params}) => {
        if(params.error){
            console.log(params.error);
            return
        }

        console.log(params);

        producerTransport = device.createSendTransport(params)
        producerTransport.on('connect', async ({dtlsParameters}, callback, errback) => {
            try {
                socket.emit('transport-connect', {
                    // transportId:producerTransport.id,
                    dtlsParameters
                })

                callback()
            } catch (error) {
                errback(error)
            }
        })

        producerTransport.on('produce', async (parameters, callback, errback) => {
            console.log(parameters)
      
            try {
              socket.emit('transport-produce', {
                    // transportId:producerTransport.id,
                    kind: parameters.kind,
                    rtpParameters: parameters.rtpParameters,
                    appData: parameters.appData,
                }, ({ id }) => {
                    callback({ id });
                })
            } catch (error) {
              errback(error)
            }
          })
    })
}

const connectSendTransport = async () => {
    producer = await producerTransport.produce(params)

    producer.on('trackended', () => {
        console.log('track ended');
    })

    producer.on('transportclose', () => {
        console.log('transport ended');
    })
}

const createRecvTransport = async () => {
    socket.emit('createWebRTCTransport', { sender:false }, ({ params }) => {
        if(params.error){
            console.log(params.error);
            return
        }

        console.log(params);

        consumerTransport = device.createRecvTransport(params)

        consumerTransport.on('connect', async ({dtlsParameters}, callback, errback) => {
            try {
                socket.emit('transport-recv-connect', {
                    dtlsParameters
                })

            } catch (error) {
                errback(error)
            }
        })
    })
}

const connectRecvTransport = async () => {
    socket.emit('consume', {
        rtpCapabilities: device.rtpCapabilities
    }, async ({ params }) => {
        if (params.error) {
            console.log('Cannot consume');
            return;
        }

        console.log(params);
        consumer = await consumerTransport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters
        });

        const { track } = consumer;
        document.querySelector(".remotestream").srcObject = new MediaStream([track]);

        socket.emit('consumer-resume');
    })
}

document.querySelector("#getLocalStream").addEventListener("click", getLocalStream)
document.querySelector("#getRtpCapabilities").addEventListener("click", getRtpCapabilities)
document.querySelector("#createDevice").addEventListener("click", createDevice)
document.querySelector("#createSendTransport").addEventListener("click", createSendTransport)
document.querySelector("#connectSendTransport").addEventListener("click", connectSendTransport)
document.querySelector("#createRecvTransport").addEventListener("click", createRecvTransport)
document.querySelector("#connectRecvTransport").addEventListener("click", connectRecvTransport)