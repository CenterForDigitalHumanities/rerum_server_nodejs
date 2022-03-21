/**
 * @author thehabes
 * Mock an /v1/id request.  This involves looking into a bucket of JSON objects and pulling one out.
 * You decide which one to pull out by being handed the _id of the thing you are looking for.
 * You either hand back that thing (JSON Object) or nothing (no object with _id)
 */ 

const bucket = [
  {
    "_id":"abcde",
    "__rerum":{},
    "@id":"abcde"
  },
  {
    "_id":"fghij",
    "__rerum":{},
    "@id":"fghij"
  }
]

exports.id = async function(_id) {
  let r = {}
  return new Promise((resolve, reject) => {
    let obj = bucket.filter(o=>o["_id"]===_id)[0]
    r.body = obj
    process.nextTick(() =>{
      Object.keys(obj).length
        ? resolve(r)
        : reject({
            error: `There was no object with _id "${_id}"`,
          })
      }
    )
  })
  
}
