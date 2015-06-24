(function($) {

// Cross domain always for LF
$.ajaxSetup({
	xhrFields: {
		withCredentials: true
	}
});

/**
 * Be nice with the `fyre` namespace
 */
var fyre = window.fyre = window.fyre || {};
fyre.ratings = fyre.ratings || {};

/**
 * Configuration object.
 * This could probably be injected.
 * @const
 * @type {{NETWORK: string, ENV: string}}
 */
fyre.ratings.CONFIG = {
	NETWORK: 'client-solutions.fyre.co',
};

/**
 * Basic string formatter that js lacks
 * @param {string} str
 * @param {...string} var_args
 */
function strFormat(str, var_args) {
    var i = 1,
    	len = arguments.length-1,
    	matches = str.match(/{}/g);

    if (!matches || matches.length !== len) {
        throw 'wrong number of arguments';
    }
    while (i <= len) {
        str = str.replace(/{}/, arguments[i]);
        i++;
    }
    return str;
};

/**
 * Url base helper
 * @param {string} subdomain
 * @return {string}
 */
function getUrlHost(subdomain) {
	var C  = fyre.ratings.CONFIG;
	return strFormat("http://{}.{}", subdomain, C.NETWORK);
};

/**
 * List of unformatted endpoints
 * @type {Object.<string, string>}
 */
var fyreEndPoints = {
	'bsInit': getUrlHost('bootstrap') + '/bs3/v3.1/{}/{}/{}/init',
	'bsCreate': getUrlHost('quill') + '/api/v3.0/site/{}/collection/create/',
	'postRating': getUrlHost('quill') + '/api/v3.0/collection/{}/post/rating/?lftoken={}',
	'hasPosted': getUrlHost('bootstrap') + '/api/v3.0/collection/{}/posted/rating/?lftoken={}'
};

/**
 * Get specific url type
 * @param {string} type
 * @param {...string} var_args
 * @return {string}
 */
function getUrl(type, var_args) {
	var args = $.makeArray(arguments),
		C = fyre.ratings.CONFIG,
		base, path,
		urlType = args.shift(),
		endpoint = fyreEndPoints[urlType];

	if (!endpoint) {
		throw 'Unknown url type: ' + urlType;
	}

	return strFormat.apply(null, [endpoint].concat(args));
};

/**
 * Information about the collection
 * @type {{id: (number|null), token: (string|null), fetchTries: number}}
 */
fyre.ratings.collectionInfo = {
	id: null,
	token: null,
	fetchTries: 0
};

/**
 * Get collection is a bit funky. On failure, it tries to create the
 * collection, but then it must re-fetch on collection create
 * success (thus the weird big failure function).
 * @param {string} siteId
 * @param {string} articleId
 * @param {jQuery.Deferred} defer
 */
function getCollection(siteId, articleId, defer) {
	var failure = function() {
		var tries = fyre.ratings.collectionInfo.fetchTries;
		if (tries === 1) {
			createCollection(siteId, articleId).always(function() {
				getCollection(siteId, articleId, defer);
			});
		} else if (tries < 3) {
			setTimeout(function() {
				getCollection(siteId, articleId, defer);
			}, 2000);
		}
	};

	// NOTE: Use a base64 lib as this will choke in many cases.
	var b64ArticleId = btoa(articleId),
		C  = fyre.ratings.CONFIG,
		url = getUrl('bsInit', C.NETWORK, siteId, b64ArticleId),
		getter = $.ajax({
			url: url
			});
	fyre.ratings.collectionInfo.fetchTries++;
	getter.done(function(data) {
		defer.resolve(data);
	}).fail(failure);
};

/**
 * Create collection uses an unsigned collection meta; In a
 * production environment this should be signed.
 * @param {string} siteId
 * @param {string} articleId
 * @param {jQuery.Deferred} defer
 */
function createCollection(siteId, articleId, defer) {
	var url = getUrl('bsCreate', siteId),
		create = $.ajax({
			url: url,
			type: 'POST',
			data: JSON.stringify({
				'signed': false,
				'collectionMeta': {
					'articleId': articleId,
					'title': document.title,
					'url': 'http://rosspfahler.com/abc', // window.location.href
					'type': 'ratings'
				}
			})
		});

	create.fail(function(data) {
		if (data.status === 409) {
			return;
		}
		throw 'Error creating collection: ' + data;
	});
	return create;
};

/**
 * Fetch the ratings for a particular siteId and articleId
 * @param {string} siteId
 * @param {string} articleId
 * @param {function(Object)} callback
 */
fyre.ratings.fetch = function(siteId, articleId) {
	var defer = $.Deferred();
	getCollection(siteId, articleId, defer);
	return defer.then(function(result) {
		fyre.ratings.collectionInfo.id = result['collectionSettings']['collectionId'];
		return result['ratings']['content'];
	});
};

/**
 * Login a user, and check if 
 * @param {string} token
 */
fyre.ratings.login = function(token) {
	var defer = $.Deferred(),
		collectionInfo = fyre.ratings.collectionInfo;

	if (!token) {
		return defer.reject();
	}

	defer.resolve(token);
	return defer.then(function() {
		collectionInfo.token = token;
		var req = $.ajax({
			url: getUrl('hasPosted', collectionInfo.id, token)
		})
		return req.then(function(data) {
			return data['data']['rating'];
		});
	});
};

/**
 * Post a review. It is assumed that the poster has logged in already via
 * fyre.ratings.login.
 *
 * @param {number} score
 * @return {jQuery.Deferred}
 */
fyre.ratings.post = function(score) {
	var collectionInfo = fyre.ratings.collectionInfo,
		data = {
		'rating': JSON.stringify({
			// NOTE: This is the rating dimension that is setup
			// when creating a collection.
			'default': score
			})
		};

	if (!collectionInfo.token) {
		throw 'Must be authenticated to send a rating';
	}

	return $.ajax({
		url: getUrl('postRating', collectionInfo.id,
			collectionInfo.token),
		type: 'POST',
		data: data
	});
};

})(jQuery);