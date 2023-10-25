# RERUM API v1
A NodeJS web service for interaction with the RERUM digital object repository.
Visit [rerum.io](https://rerum.io) for more general information.
Want to use the API?  Learn how at the [API page](https://store.rerum.io/v1/API.html).

Stores important bits of knowledge in structured JSON-LD objects:

* Web Annotation / Open Annotation objects
* SharedCanvas / International Image Interoperability Framework objects
* FOAF Agents
* _any_ valid JSON object, even if there is no type specified!

## Basic Principles

1. **As RESTful as is reasonable**—accept and respond to a broad range of requests without losing the map;
1. **As compliant as is practical**—take advantage of standards and harmonize conflicts;
1. **Save an object, retrieve an object**—store metadata in private (`__rerum`) property, rather than wrap all data transactions;
1. **Trust the application, not the user**—avoid multiple login and authentication requirements and honor open data attributions;
1. **Open and Free**—expose all contributions immediately without charge to write or read;
1. **Attributed and Versioned**—always include asserted ownership and transaction metadata so consumers can evaluate trustworthiness and relevance.

## What we add

You will find a `__rerum` property on anything you read from this repository. This is written onto
all objects by the server and is not editable by the client applications. While applications may assert
_anything_ within their objects, this property will always tell the Truth. The details are in the
documentation, but broadly, you will find:

* `@context`   the RERUM API JSON-LD context file for these terms
* `alpha`  internal flag for RERUM API version control 
* `APIversion` specific RERUM API release version for this data node
* `createdAt`  specific creation date for this \[version of this] object
* `generatedBy`  the agent for the application that authenticated to create this object
* `isOverwritten`  specific date (if any) this version was updated without versioning
* `isReleased`  a special flag for RERUM, indicating this version is intentionally public and immutable
* `releases`  an object containing the most recent anscestor and descendant releases
* `history`  an object containing the first, previous, and immediate derivative versions of this object
  
### Default Installation
The following is a git shell example for installing the RERUM API web app.

#### Get a MongoDB Database
Check out [MongoDB Atlas](https://www.mongodb.com/atlas/database) for a cloud hosted solution as well as instructions for installing MongoDB on your development machines.

#### Get the Code
```shell
cd /code_folder
git clone https://github.com/CenterForDigitalHumanities/rerum_server_nodejs.git rerum_api
npm install
```

#### Create the Configuration File
Create a file named `.env` in the root folder.  In the above example, the root is `/code_folder/tiny_things`.  `/code_folder/tiny_things/.env` looks like this:

```shell
RERUM_API_VERSION = 1.0.0
RERUM_BASE = URL_OF_YOUR_DEPLOYMENT
RERUM_PREFIX = URL_OF_YOUR_DEPLOYMENT/v1/
RERUM_ID_PREFIX = URL_OF_YOUR_DEPLOYMENT/v1/id/
RERUM_AGENT_CLAIM = URL_OF_YOUR_DEPLOYMENT/agent
RERUM_CONTEXT = URL_OF_YOUR_DEPLOYMENT/v1/context.json
RERUM_API_DOC = URL_OF_YOUR_DEPLOYMENT/b1/API.html
MONGO_CONNECTION_STRING = OBTAINED_FROM_MONGODB_SET_UP
MONGODBNAME = OBTAINED_FROM_MONGODB_SET_UP
MONGODBCOLLECTION = OBTAINED_FROM_MONGODB_SET_UP
DOWN = false
READONLY = false
BOT_TOKEN = OBTAINED_FROM_BOT_REGISTRATION
BOT_AGENT = OBTAINED_FROM_BOT_REGISTRATION
```

Now, you can run tests
```shell
npm run runtest
```

And start the app
```shell
npm start
```

To stop the application, kill or exit the process via your shell (<kbd>CTRL + C</kbd> or <kbd>CTRL + X</kbd>).



### Advanced Installation
The default installation does not come with data atrribution and API authorization.  If this is required for your RERUM API, you will need an Auth0 account and an Auth0 Tenant.

Add the following properties to your `.env` file

```shell
AUDIENCE = OBTAINED_FROM_AUTH0_SET_UP
ISSUER_BASE_URL = OBTAINED_FROM_AUTH0_SET_UP
CLIENTID = OBTAINED_FROM_AUTH0_SET_UP
RERUMSECRET = OBTAINED_FROM_AUTH0_SET_UP
```

#### Set Up an Auth0 Authorization Flow
To set up the Auth0 powered attribution and Authorization you will need some special Actions on top of a standard Authorization Flow.
- This
- That
- The Other
  
## 🌟👍 Contributors 👍🌟
Trying to contribute or perform a fix in the RERUM API?  If not, are you _sure_ you don't want to?  Read the [Contributors Guide](CONTRIBUTING.md)!

## Who is to blame?
The developers in the Research Computing Group at Saint Louis University authored and maintain this service.
Neither specific warranty or rights are associated with RERUM; registering and contributing implies only those rights 
each object asserts about itself. We welcome sister instances of RERUM, ports to other languages, package managers, builds, etc.
Contributions to this repository will be accepted as pull requests.
