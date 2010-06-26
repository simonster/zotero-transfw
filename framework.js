/**
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/* Generic code */
var FW = {
    _scrapers : new Array()
};

FW._Base = function () {
    this.evaluate = function (key, doc, url) {
	var val = this[key];
        var valtype = typeof val;
        if (valtype === 'string') {
            return val;
        } else if (valtype === 'object') {
            return val.evaluate(doc, url);
        } else if (valtype === 'function') {
            return val(doc, url);
        } else {
            return undefined;
        }
    };
};

FW.Scraper = function (init) { 
    FW._scrapers.push(new FW._Scraper(init));
};

FW._Scraper = function (init) {
    for (x in init) {
        this[x] = init[x];
    }

    this.makeItems = function (doc, url) {
        var item = new Zotero.Item(this.itemType);
        item.url = url;
        var fields = new Array("title", "publicationTitle", "date", "volume", "issue");
        for (var i in fields) {
            var field = fields[i];
            var fieldVal = this.evaluate(field, doc, url);
            if (fieldVal instanceof Array) {
                item[field] = fieldVal[0];
            } else {
                item[field] = fieldVal;
            }
        }
        var multiFields = ["creators", "attachments"];
        for (var j in multiFields) {
            var key = multiFields[j];
            var val = this.evaluate(key, doc, url);
            if (val) {
                for (var k in val) {
                    item[key].push(val[k]);
                }
            }
        }
        return [item];
    };
};

FW._Scraper.prototype = new FW._Base;

FW.MultiScraper = function (init) { 
    FW._scrapers.push(new FW._MultiScraper(init));
};

FW._MultiScraper = function (init) {
    for (x in init) {
        this[x] = init[x];
    }

    this._mkSelectItems = function(titles, urls) {
        var items = new Object;
        for (var i in titles) {
            items[urls[i]] = titles[i];
        }
        return items;
    };

    this._selectItems = function(titles, urls) {
        var items = new Array();
        for (var j in Zotero.selectItems(this._mkSelectItems(titles, urls))) {
            items.push(j);
        }
       return items;
    };

    this._mkAttachments = function(doc, url, urls) {
        var attachmentsArray = this.evaluate('attachments', doc, url);
        var attachmentsDict = new Object();
        if (attachmentsArray) {
            for (var i in urls) {
                attachmentsDict[urls[i]] = attachmentsArray[i];
            }
        }
        return attachmentsDict;
    };

    this.makeItems = function(doc, url) {
        Zotero.debug("Entering MultiScraper.makeItems");
        if (this.beforeFilter) {
            var newurl = this.beforeFilter(doc, url);
            if (newurl != url) {
                return this.makeItems(Zotero.Utilities.retrieveDocument(url), newurl);
            }
        }
        var titles = this.evaluate('titles', doc, url);
        var urls = this.evaluate('urls', doc, url);
        var itemsToUse = this._selectItems(titles, urls);
        var attachments = this._mkAttachments(doc, url, urls);
        if(!itemsToUse) {
	    Zotero.done(true);
	    return [];
	} else {
            var madeItems = new Array();
            for (var i in itemsToUse) {
                var url1 = itemsToUse[i];
                var doc1 = Zotero.Utilities.retrieveDocument(url1);
                var itemTrans;
                if (this.itemTrans) {
                    itemTrans = this.itemTrans;                    
                } else {
                    itemTrans = FW.getScraper(doc1, url1);                    
                }
                Zotero.debug(itemTrans);
                var items = itemTrans.makeItems(doc1, url1, attachments[url1]);
                madeItems.push(items[0]);
            }
            return madeItems;
        }
    };
};

FW._MultiScraper.prototype = new FW._Base;

FW.DelegateTranslator = function (init) { 
    return new FW._DelegateTranslator(init);
};

FW._DelegateTranslator = function (init) {
    for (x in init) {
        this[x] = init[x];
    }
    
    this._translator = Zotero.loadTranslator(this.translatorType);
    this._translator.setTranslator(this.translatorId);
    
    this.makeItems = function(doc, url, attachments) {
        Zotero.debug("Entering DelegateTranslator.makeItems");
        var tmpItem;
        var text = Zotero.Utilities.retrieveSource(url);
        this._translator.setHandler("itemDone", function(obj, item) { 
                                        tmpItem = item;
                                        /* this does not seem to be working */
                                        if (attachments) { item.attachments = attachments; }
                                    });
	this._translator.setString(text);
        this._translator.translate();
        Zotero.debug("Leaving DelegateTranslator.makeItems");
        return [tmpItem];
    };
};

FW.DelegateTranslator.prototype = new FW._Scraper;

FW._StringMagic = function () {
    this._filters = new Array();

    this.addFilter = function(filter) {
        this._filters.push(filter);
        return this;
    };

    this.split = function(re) {
        return this.addFilter(function(s) {
            return s.split(re).filter(function(e) { return (e != ""); });
        });
    };

    this.replace = function(s1, s2, flags) {
        return this.addFilter(function(s) {
            return s.replace(s1, s2, flags);
        });
    };

    this.prepend = function(prefix) {
        return this.replace(/^/, prefix);
    };

    this.append = function(postfix) {
        return this.replace(/$/, postfix);
    };

    this.remove = function(toStrip, flags) {
        return this.replace(toStrip, '', flags);
    };

    this.trim = function() {
        return this.addFilter(function(s) { return Zotero.Utilities.trim(s); });
    };

    this.trimInternal = function() {
        return this.addFilter(function(s) { return Zotero.Utilities.trimInternal(s); });
    };

    this.match = function(re, group) {
        if (!group) group = 1;
        return this.addFilter(function(s) { return s.match(re)[group]; });
    };

    this.cleanAuthor = function(type) {
        return this.addFilter(function(s) { return Zotero.Utilities.cleanAuthor(s, type); });
    };

    this.key = function(field) {
        return this.addFilter(function(n) { return n[field]; });
    };

    this.capitalizeTitle = function() {
        return this.addFilter(function(s) { return Zotero.Utilities.capitalizeTitle(s); });
    };

    this.unescapeHTML = function() {
        return this.addFilter(function(s) { return Zotero.Utilities.unescapeHTML(s); });
    };

    this.unescape = function() {
        return this.addFilter(function(s) { return unescape(s); });
    };

    this.makeAttachment = function(type, title) {
        var filter = function(url) {
            if (url) {
                return { url   : url,
                         type  : type,
                         title : title };
            } else {
                return undefined;
            }
        };
        return this.addFilter(filter);
    };

    this._flatten = function(a) {
        var retval = new Array();
        for (var i in a) {
            if (a[i] && (typeof a[i]) === 'object' && a[i].splice) { /* assume only arrays have the splice property */
                retval = retval.concat(this._flatten(a[i]));
            } else {
                retval.push(a[i]);
            }
        }
        return retval;
    };

    this._applyFilters = function(a, doc1) {
        Zotero.debug("Entering StringMagic._applyFilters");
        for (i in this._filters) {
            a = this._flatten(a);
            for (var j = 0 ; j < a.length ; j++) {
                try {
                    if (typeof a[j] === 'undefined') { continue; }
                    else { a[j] = this._filters[i](a[j], doc1); }
                } catch (x) {
                    a[j] = undefined;
                    Zotero.debug("Caught exception on filter: " + this._filters[i]);
                }
            }
        }
        return a;
    };
};

FW.PageText = function () {
    return new FW._PageText();
};

FW._PageText = function() {
    this._filters = new Array();

    this.evaluate = function (doc) {        
        var a = [doc.documentElement.innerHTML];
        a = this._applyFilters(a, doc);
        if (a.length == 0) { return false; }
        else { return a; }
    };
};

FW._PageText.prototype = new FW._StringMagic();

FW.Url = function () { return new FW._Url(); };

FW._Url = function () {
    this._filters = new Array();

    this.evaluate = function (doc, url) {        
        var a = [url];
        a = this._applyFilters(a, doc);
        if (a.length == 0) { return false; }
        else { return a; }
    };
};

FW._Url.prototype = new FW._StringMagic();

FW.Xpath = function (xpathExpr) { return new FW._Xpath(xpathExpr); };

FW._Xpath = function (_xpath) {
    this._xpath = _xpath;
    this._filters = new Array();

    this.text = function() {
        var filter = function(n) {
            if (typeof n === 'object' && n.textContent) { return n.textContent; }
            else { return n; }
        };
        this.addFilter(filter);
        return this;
    };

    this.sub = function(xpath) {
        var filter = function(n, doc) {
            var result = doc.evaluate(xpath, n, null, XPathResult.ANY_TYPE, null);
            if (result) {
                return result.iterateNext();
            } else {
                return undefined;               
            }
        };
        this.addFilter(filter);
        return this;
    };

    this.evaluate = function (doc) {
        var it = doc.evaluate(this._xpath, doc, null, XPathResult.ANY_TYPE, null);
        var a = new Array();
        var x;
        while (x = it.iterateNext()) { a.push(x); }
        a = this._applyFilters(a, doc);
        if (a.length == 0) { return false; }
        else { return a; }
    };
};

FW._Xpath.prototype = new FW._StringMagic();

FW.detectWeb = function (doc, url) {
    for (var i in FW._scrapers) {
	var scraper = FW._scrapers[i];
	var itemType = scraper.evaluate('itemType', doc, url);
	if (!scraper.detect) {
	    return itemType;
	} else {
	    var v = scraper.evaluate('detect', doc, url);
            if (v.length > 0 && v[0]) {
		return itemType;
	    }
	}
    }
    return undefined;
};

FW.getScraper = function (doc, url) {
    var itemType = FW.detectWeb(doc, url);
    return FW._scrapers.filter(function(s) s.evaluate('itemType', doc, url) == itemType)[0];
};

FW.doWeb = function (doc, url) {
    Zotero.debug("Entering FW.doWeb");
    var scraper = FW.getScraper(doc, url);
    var items = scraper.makeItems(doc, url);
    for (var i in items) {
        items[i].complete();   
    }
    Zotero.debug("Leaving FW.doWeb");
};

/* End generic code */
