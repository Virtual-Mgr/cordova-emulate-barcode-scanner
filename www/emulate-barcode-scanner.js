let exec = require('cordova/exec');

// We are emulating as best we can the API to the phonegap-plugin-barcodescanner using the cordova-plugin-qrscanner-12 as implementation
// It is noted that the qrscanner plugin is not a drop-in replacement for the barcodescanner plugin, as it only supports QR codes not barcodes

let qrscanner = require('cordova-plugin-qrscanner-12.QRScanner');

function deferredPromise() {
    let _resolve, _reject;

    let promise = new Promise((resolve, reject) => {
        _resolve = resolve;
        _reject = reject;
    });

    return {
        promise: promise,
        resolve: _resolve,
        reject: _reject
    };
}

// Avoid CRLF before the < to avoid the JQuery warning
const qrOverlayTemplate = `<div class="qr-overlay">
    <div class="qr-overlay-porthole"></div>
    <div class="qr-overlay-instructions">
        Position QR code within the square
    </div>
    <button class="qr-overlay-btn qr-overlay-cancel-btn">
        <img src="/plugins/emulate-barcode-scanner/www/cancel.png" alt="Cancel">
    </button>
    <div class="qr-overlay-buttons">
        <button class="qr-overlay-btn qr-overlay-toggle-camera-btn qr-overlay-hidden">
            <img src="/plugins/emulate-barcode-scanner/www/flip-camera.png" alt="Flip camera">
        </button>
        <button class="qr-overlay-btn qr-overlay-toggle-torch-btn qr-overlay-hidden">
            <img src="/plugins/emulate-barcode-scanner/www/torch.png" alt="Toggle torch">
        </button>
    </div>
</div>
`;

const qrOverlayStyle = `.qr-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 9999;
}

.qr-overlay-porthole {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 50vmin;  
    height: 50vmin;
    transform: translate(-50%, -50%); 
    border: 5px dotted white;
}

.qr-overlay-instructions {
    position: absolute;
    top: calc(50% - 25vmin - 3em); 
    left: 0;
    right: 0;
    text-align: center;
    color: white;
}

.qr-body-wrapper {
    display: none;
}

.qr-overlay-hidden {
    visibility: hidden;
}

.qr-overlay-btn {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    width: 50px;    
    height: 50px;   
    border-radius: 50%;  
    border: none;
    padding: 0.3em;
    background-color: transparent; 
    overflow: hidden;  
    cursor: pointer;
}

.qr-overlay-btn img {
    display: block;
    width: 100%;  
    height: auto;
    object-fit: cover;  
}

.qr-overlay-cancel-btn {
    position: absolute;
    bottom: 2vh;
    left: 50%;
    transform: translateX(-50%);
    background-color: rgba(255, 0, 0, 0.8);
}

.qr-overlay-buttons {
    position: absolute;
    top: 2vh;
    right: 2vh;
    margin: 1em;
}

.qr-overlay-toggle-torch-btn {
}

.qr-overlay-toggle-torch-btn-on {
    background-color: rgba(255, 255, 0, 0.8);
}

.qr-overlay-toggle-torch-btn-off {
    background-color: rgba(80, 80, 80, 0.8);
}

.qr-overlay-toggle-camera-btn {
}

.qr-overlay-toggle-camera-btn-front {
    background-color: rgba(255, 255, 0, 0.8);
}

.qr-overlay-toggle-camera-btn-back {
    background-color: rgba(80, 80, 80, 0.8);
}

/* Disables pinch-zooming and scrolling, LUCIFER-937 force background-image none */
body {
    touch-action: manipulation;
    overflow: hidden;
    background-image: none !important;
}
`;

let $originalMeta;
function disableZoom() {
    if ($('meta[name="viewport"]').length) {
        $originalMeta = $('meta[name="viewport"]').clone();
        $('meta[name="viewport"]').attr('content', 'width=device-width, initial-scale=1.0, user-scalable=no');
    } else {
        $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">');
    }
}

function restoreZoom() {
    if ($originalMeta) {
        $('meta[name="viewport"]').replaceWith($originalMeta);
    } else {
        $('meta[name="viewport"]').remove();
    }
}

let $injectedStyle = null;
function injectDynamicStyle(portholeSize = 200) {
    removeDynamicStyle();

    let halfPortholeSize = portholeSize / 2;

    $injectedStyle = $('<style>')
        .prop("type", "text/css")
        .html(qrOverlayStyle.replace('{portHoleSize}', portholeSize).replace('{halfPortHoleSize}', halfPortholeSize))
        .appendTo("head");

    disableZoom();
}

function removeDynamicStyle() {
    if ($injectedStyle != null) {
        $injectedStyle.remove();
        $injectedStyle = null;
    }

    restoreZoom();
}


let emulateBarcodeScanner = {
    scan: function (success, fail, options) {
        let $bodyContent;
        let $qrOverlay;
        let $htmlOriginalStyle = $('html').attr('style');
        let $bodyOriginalStyle = $('body').attr('style');

        // options is an object with the following keys: preferFrontCamera, showFlipCameraButton, showTorchButton, torchOn, saveHistory, prompt, resultDisplayDuration, formats, orientation    
        let $startScan = deferredPromise();
        let $stopScan = deferredPromise();

        let toggleTorchBtn;
        let toggleCameraBtn;

        function updateStatus() {
            return new Promise((resolve, reject) => {
                qrscanner.getStatus(status => {
                    if (status.canEnableLight && options && options.showTorchButton) {
                        toggleTorchBtn.removeClass('qr-overlay-hidden');
                    } else {
                        toggleTorchBtn.addClass('qr-overlay-hidden');
                    }
                    if (status.canChangeCamera && options && options.showFlipCameraButton) {
                        toggleCameraBtn.removeClass('qr-overlay-hidden');
                    } else {
                        toggleCameraBtn.addClass('qr-overlay-hidden');
                    }
                    if (status.lightEnabled) {
                        toggleTorchBtn.removeClass('qr-overlay-toggle-torch-btn-off');
                        toggleTorchBtn.addClass('qr-overlay-toggle-torch-btn-on');
                    } else {
                        toggleTorchBtn.removeClass('qr-overlay-toggle-torch-btn-on');
                        toggleTorchBtn.addClass('qr-overlay-toggle-torch-btn-off');
                    }
                    if (status.currentCamera === 1) {
                        toggleCameraBtn.removeClass('qr-overlay-toggle-camera-btn-back');
                        toggleCameraBtn.addClass('qr-overlay-toggle-camera-btn-front');
                    } else {
                        toggleCameraBtn.removeClass('qr-overlay-toggle-camera-btn-front');
                        toggleCameraBtn.addClass('qr-overlay-toggle-camera-btn-back');
                    }
                    resolve(status);
                });
            });
        }

        function toggleTorch(on) {
            return new Promise((resolve, reject) => {
                if (on) {
                    toggleTorchBtn.removeClass('qr-overlay-toggle-torch-btn-off');
                    toggleTorchBtn.addClass('qr-overlay-toggle-torch-btn-on');
                    qrscanner.enableLight(resolve);
                } else {
                    toggleTorchBtn.removeClass('qr-overlay-toggle-torch-btn-on');
                    toggleTorchBtn.addClass('qr-overlay-toggle-torch-btn-off');
                    qrscanner.disableLight(resolve);
                }
            });
        }

        function toggleCamera(front) {
            return new Promise((resolve, reject) => {
                if (front) {
                    toggleCameraBtn.removeClass('qr-overlay-toggle-camera-btn-back');
                    toggleCameraBtn.addClass('qr-overlay-toggle-camera-btn-front');
                    qrscanner.useFrontCamera(resolve);
                } else {
                    toggleCameraBtn.removeClass('qr-overlay-toggle-camera-btn-front');
                    toggleCameraBtn.addClass('qr-overlay-toggle-camera-btn-back');
                    qrscanner.useBackCamera(resolve);
                }
            });
        }


        function showQRScanOverlay() {
            $bodyContent = $('<div>', {
                id: 'contentWrapper',
                class: 'qr-body-wrapper'
            }).appendTo($('body'));

            let $originalChildren = $('body').children().not($bodyContent);

            // Using jQuery's appendTo for clarity and conciseness
            $originalChildren.appendTo($bodyContent);

            $qrOverlay = $(qrOverlayTemplate);
            $qrOverlay.appendTo($('body'));

            $('.qr-overlay-cancel-btn').on('click', () => {
                qrscanner.cancelScan();
            });

            toggleTorchBtn = $('.qr-overlay-toggle-torch-btn');
            toggleTorchBtn.on('click', () => {
                toggleTorch(!toggleTorchBtn.hasClass('qr-overlay-toggle-torch-btn-on')).then(() => {
                    updateStatus();
                });
            });

            toggleCameraBtn = $('.qr-overlay-toggle-camera-btn');
            toggleCameraBtn.on('click', () => {
                toggleCamera(!toggleCameraBtn.hasClass('qr-overlay-toggle-camera-btn-front')).then(() => {
                    updateStatus();
                });
            });

            return Promise.resolve();
        }

        function hideQRScanOverlay() {
            // Transfer wrapper children back to the body
            $bodyContent.children().appendTo($('body'));
            $bodyContent.remove();
            $bodyContent = null;

            $qrOverlay.remove();
            $qrOverlay = null;

            // Restore HTML/Body styles
            if ($htmlOriginalStyle) {
                $('html').attr('style', $htmlOriginalStyle);
            } else {
                $('html').removeAttr('style');
            }
            if ($bodyOriginalStyle) {
                $('body').attr('style', $bodyOriginalStyle);
            } else {
                $('body').removeAttr('style');
            }

            return Promise.resolve();
        }

        function toggleQROverlay(show) {
            if (show) {
                return showQRScanOverlay();
            } else {
                return hideQRScanOverlay();
            }
        }

        injectDynamicStyle();

        $startScan.promise.then(() => {
            toggleQROverlay(true);

            toggleTorch(options && options.torchOn);
            toggleCamera(options && options.preferFrontCamera);

            // Handle showing torch on/off button
            if (options && options.showTorchButton) {
                toggleTorchBtn.removeClass('qr-overlay-hidden');
            }

            // Handle showing front/back camera button
            if (options && options.showFlipCameraButton) {
                toggleCameraBtn.removeClass('qr-overlay-hidden');
            }
        });

        $stopScan.promise.then(() => {
            toggleTorch(false).then(() => {
                qrscanner.destroy();
                toggleQROverlay(false);

                removeDynamicStyle();
            });
        });

        $startScan.promise.then(() => {
            qrscanner.show(() => {
                updateStatus().then(() => {
                    qrscanner.scan((err, result) => {
                        $stopScan.resolve();

                        if (err) {
                            fail(err);
                        } else {
                            success({
                                text: result,
                                format: 'qr_CODE'
                            });
                        }
                    });
                });
            }, err => {
                $stopScan.resolve();
                fail(err);
            });
        });

        $startScan.resolve();
    }
};

module.exports = emulateBarcodeScanner;
