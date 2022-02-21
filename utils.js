
//An options request came through, give it a heartbeat of 200
exports.checkIIIFCompliance = async function (objURL, version) {
    try{
        res.set("Access-Control-Allow-Origin", "*")
        res.set("Access-Control-Allow-Headers", "*")
        res.set("Access-Control-Expose-Headers", "*")
        res.set("Access-Control-Allow-Methods", "*")
        res.sendStatus(200)
    }
    catch(err){
        console.error("Error processing an OPTIONS method request")
        console.log(err)
        res.json({"err":err})
        res.sendStatus(500)
    }
}